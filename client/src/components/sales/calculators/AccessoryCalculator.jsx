import { useState, useEffect, useMemo, memo } from 'react';
import { useAttributes } from '../../../context/AttributeContext';
import { useProducts } from '../../../context/ProductContext';
import { poolSiblings } from '../../../utils/poolKey';

const inputStyle = {
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '0.625rem', padding: '0.625rem 0.875rem', color: '#f1f5f9',
    fontSize: '0.875rem', outline: 'none', width: '100%', boxSizing: 'border-box',
    fontFamily: 'var(--font-mono)', transition: 'border-color 0.2s',
};
const sectionStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.875rem', padding: '1rem', marginBottom: '0.75rem' };

// What one whole sealed pack of this product is called. Length-measured goods
// (rubber, beading) come on rolls; countable goods come in boxes. Wording only —
// both behave identically, and both are sold with the same 'accessory-unit' line.
const LENGTH_UNITS = new Set(['m', 'cm', 'mm', 'ft', 'in']);
const packNounFor = (unit) => (LENGTH_UNITS.has(unit) ? 'Roll' : 'Box');
const packPlural = (noun) => (noun === 'Box' ? 'boxes' : 'rolls');
// What the sub-pack unit is called, in words — used both on its button and as
// the cart/receipt line label, so a metre sale never reads as "Pieces". Falls
// back to the unit's own symbol, capitalised, for anything not listed.
const UNIT_NOUNS = {
    pcs: 'Pieces', m: 'Metres', cm: 'Centimetres', mm: 'Millimetres', ft: 'Feet', in: 'Inches',
};
const unitNounFor = (unit) => (
    UNIT_NOUNS[unit] || (unit ? unit.charAt(0).toUpperCase() + unit.slice(1) : 'Pieces')
);

/** Which of the two sale modes a variant can actually be sold in.
 *
 * These are INDEPENDENT: selling a whole sealed roll/box and selling units out
 * of an opened one are both normal, and an open-container product in particular
 * must always be able to sell a sealed pack — that is the only thing its stock
 * counts exactly. Each needs its own price set, so each is offered only when
 * that price exists, rather than one being treated as the other's fallback. */
const saleOptionsFor = (item, openContainerMode = false) => {
    const wholePackPrice = item.price || item.priceFull || 0;
    return {
        wholePackPrice,
        canSellWholePack: wholePackPrice > 0,
        // An open-container product is sold out of an opened pack by definition,
        // so a per-unit price is the only requirement — it does NOT need the pack
        // to state a size. Nothing below a pack is tracked in that mode, so there
        // is no pack size to divide against and none is needed.
        // A counted packaged accessory does need one: there, a piece sale is
        // resolved against an exact pieces-per-pack figure.
        canSellUnits: openContainerMode
            ? item.priceUnit > 0
            : !!(item.unitQuantity > 0 && item.priceUnit > 0),
    };
};

/** Resolves the chosen mode against what's actually sellable, so a variant with
 *  only one priced option lands on it instead of on a dead choice. */
const resolveSaleUnit = (chosen, { canSellWholePack, canSellUnits }) => {
    if (chosen === 'pcs') return canSellUnits ? 'pcs' : 'box';
    return canSellWholePack || !canSellUnits ? 'box' : 'pcs';
};
const labelStyle = { fontSize: '0.62rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase' };

const AccessoryCalculator = memo(({ product, initialDetails, onUpdate }) => {
    const hasVariants = product.variants && product.variants.length > 0;
    const { attributeClasses } = useAttributes();
    const { hasOpenPack } = useProducts();
    // When true, this product's `stock` counts whole SEALED packs and nothing
    // inside an opened one is tracked -- a pack's real contents vary too much
    // to count (rubber rolls run long or short, screw boxes are bought by
    // weight). A sub-pack sale therefore isn't limited by a quantity at all;
    // it's limited by whether a manager has a pack open. See
    // server/entities/openContainers.py.
    const openContainerMode = product.unitStockMode === 'open_container';
    const attributeTypesMap = useMemo(() => {
        const m = {};
        attributeClasses.forEach(c => { m[c.name] = c.type; });
        return m;
    }, [attributeClasses]);

    const [selections, setSelections] = useState(() => {
        if (initialDetails?.selectedAttributes) return initialDetails.selectedAttributes;
        const defaults = {};
        if (hasVariants) {
            const attrKeys = Object.keys(product.variants[0].attributes || {});
            attrKeys.forEach(key => { defaults[key] = null; });
        }
        return defaults;
    });

    const selectedVariant = useMemo(() => {
        if (!hasVariants) return product;
        return product.variants.find(v =>
            Object.entries(selections).every(([key, val]) => v.attributes[key] === val)
        ) || null;
    }, [product, hasVariants, selections]);

    const availableAttributes = useMemo(() => {
        if (!hasVariants) return {};
        const attrs = {};
        product.variants.forEach(v => {
            Object.entries(v.attributes).forEach(([key, val]) => {
                if (!attrs[key]) attrs[key] = new Set();
                attrs[key].add(val);
            });
        });
        const result = {};
        Object.keys(attrs).forEach(k => result[k] = Array.from(attrs[k]));
        return result;
    }, [product.variants, hasVariants]);

    useEffect(() => {
        if (hasVariants) {
            setSelections(prev => {
                const next = { ...prev };
                let changed = false;
                Object.entries(availableAttributes).forEach(([key, opts]) => {
                    if (opts.length > 0 && !next[key]) {
                        const def = product.defaultAttributes?.[key];
                        next[key] = (def && opts.includes(def)) ? def : opts[0];
                        changed = true;
                    }
                });
                return changed ? next : prev;
            });
        }
    }, [availableAttributes, hasVariants, product.defaultAttributes]);

    const [qtyFull, setQtyFull] = useState(initialDetails?.qtyFull || 0);
    const [qtyHalf, setQtyHalf] = useState(initialDetails?.qtyHalf || 0);
    const [cutLength, setCutLength] = useState(initialDetails?.cutLength || '');
    const [qty, setQty] = useState(initialDetails?.qty || 1);
    const [salesMode] = useState(initialDetails?.salesMode || 'roll');
    // 'box' | 'pcs' — only meaningful when the active variant is packaged (has both
    // unitQuantity = pieces per box and priceUnit = price per single piece set).
    const [saleUnit, setSaleUnit] = useState(initialDetails?.saleUnit || 'box');

    const rollOptions = product.rollOptions || (product.priceRoll ? [{ label: 'Standard Roll', length: product.rollLength, price: product.priceRoll }] : []);
    const hasRollOption = rollOptions.length > 0 && !hasVariants;
    const [selectedRoll] = useState(initialDetails?.selectedRoll || (hasRollOption ? rollOptions[0] : null));
    const [error, setError] = useState(null);

    useEffect(() => {
        if (hasVariants && !selectedVariant) { onUpdate(0, { isValid: false, warning: 'Please select options' }); return; }
        const activeItem = selectedVariant || product;
        const trackOffcuts = activeItem.trackOffcuts || product.trackOffcuts;
        let total = 0;
        const lineItems = [];
        const attributesDetail = [];
        let isValid = true;
        let finalError = null;

        if (hasVariants) Object.entries(selections).forEach(([k, v]) => { if (v) attributesDetail.push({ label: k, value: v }); });
        if (!hasVariants && product.hasColor && initialDetails?.color) attributesDetail.push({ label: 'Color', value: initialDetails.color });

        const stock = activeItem.stock || 0;

        // Pooled piece-equivalent stock across sibling variants that share every
        // attribute except the pack-size one — a piece sale doesn't care which
        // sealed box (or already-loose stock) a piece comes from, so this sums
        // every pool member's own stock as a rough upper bound (the real backend
        // check also lets a sealed box get OPENED to cover a shortfall — see
        // inventoryService.py's _deduct_packaged_stock_pooled — but that box's
        // own stock is already included in this sum, so this stays accurate,
        // just possibly conservative if a shared loose-pieces pool from an
        // earlier opened box exists server-side that this client-side estimate
        // can't see). Only used for the PCS branch below — a box/pack sale
        // never pools, see that branch's own comment. See utils/poolKey.js.
        const poolMembers = hasVariants && selectedVariant
            ? [selectedVariant, ...poolSiblings(product.variants, selectedVariant, attributeTypesMap, product.poolIgnoredAttributes)]
            : [activeItem];
        const pooledPieces = poolMembers.reduce((sum, v) => sum + (v.stock || 0), 0);

        if (trackOffcuts) {
            const pFull = activeItem.priceFull || activeItem.price || 0;
            const pHalf = activeItem.priceHalf || 0;
            const pCut = activeItem.priceUnit || activeItem.priceFoot || 0;
            const totalFullPrice = qtyFull * pFull;
            const totalHalfPrice = qtyHalf * pHalf;
            let totalCutPrice = 0;
            const l = parseFloat(cutLength) || 0;
            if (l > 0) totalCutPrice = l * pCut;
            total = totalFullPrice + totalHalfPrice + totalCutPrice;
            if (qtyFull > stock) { finalError = `Insufficient Stock (Full). Have ${stock}`; isValid = false; }
            if (qtyFull > 0) lineItems.push({ type: 'accessory-full', label: 'Full', qty: qtyFull, rate: pFull, total: totalFullPrice });
            if (qtyHalf > 0) lineItems.push({ type: 'accessory-half', label: 'Half', qty: qtyHalf, rate: pHalf, total: totalHalfPrice });
            if (totalCutPrice > 0) lineItems.push({ type: 'accessory-cut', label: `Cut ${l}${activeItem.unit || ''}`, qty: 1, rate: pCut * l, total: totalCutPrice, meta: { length: l, unit: activeItem.unit || '' } });
            onUpdate(total, { lineItems, attributes: attributesDetail, qtyFull, qtyHalf, cutLength: l > 0 ? l : null, cutQty: 1, trackOffcuts: true, variantId: hasVariants && selectedVariant ? (selectedVariant.variantId || selectedVariant.id) : null, isValid, warning: finalError });
        } else {
            const saleOptions = saleOptionsFor(activeItem, openContainerMode);
            const { canSellWholePack, canSellUnits, wholePackPrice } = saleOptions;
            const effectiveSaleUnit = resolveSaleUnit(saleUnit, saleOptions);
            const packNoun = packNounFor(activeItem.unit);
            if (hasRollOption && salesMode === 'roll') {
                const price = selectedRoll?.price || 0;
                total = qty * price;
                lineItems.push({ type: 'accessory-roll', label: selectedRoll?.label || 'Roll', qty, rate: price, total, meta: { length: selectedRoll?.length } });
                attributesDetail.push({ label: 'Roll Type', value: selectedRoll?.label });
            } else {
                if (effectiveSaleUnit === 'pcs') {
                    const price = activeItem.priceUnit || 0;
                    total = qty * price;
                    if (openContainerMode) {
                        // No quantity to check: what's left inside an opened
                        // pack is deliberately untracked, so the only thing that
                        // can block this sale is nothing being open. Matches the
                        // backend's one check in _dispense_from_open_container.
                        if (!hasOpenPack(product, hasVariants ? selectedVariant : null, attributeTypesMap)) {
                            // Points at the other option deliberately: a sealed pack is
                            // always sellable whole, so "nothing is open" blocks only
                            // this way of selling, not the item.
                            finalError = `No open ${packNoun.toLowerCase()} — a manager must open one, `
                                + `or sell a full ${packNoun.toLowerCase()} instead`;
                            isValid = false;
                        }
                    } else {
                        const availablePcs = pooledPieces;
                        if (qty > availablePcs) { finalError = `Only ${availablePcs} pcs available`; isValid = false; }
                    }
                    // Labelled by the product's own unit, not a hardcoded "Pieces" —
                    // this string is what the cart, receipt and order summary show,
                    // so a 20-metre rubber sale must not read as "Pieces x20".
                    lineItems.push({
                        type: 'accessory-pcs', label: unitNounFor(activeItem.unit), qty, rate: price, total,
                        meta: { unit: activeItem.unit || 'pcs', unitQuantity: activeItem.unitQuantity },
                    });
                } else {
                    // Box/pack sale: the customer gets actual sealed boxes of THIS
                    // variant's own pack size, so unlike a piece sale this checks
                    // (and the backend deducts) only against this variant's own
                    // sealed stock — never pooled or substituted from a sibling
                    // pack size or the loose-pieces pool. See
                    // inventoryService.py's _deduct_packaged_stock_pooled
                    // docstring for why a piece sale is different.
                    const price = wholePackPrice;
                    total = qty * price;
                    // In open-container mode `stock` already counts whole packs,
                    // so dividing by the (nominal, unreliable) pack size would
                    // wrongly shrink what's available -- see the backend's
                    // matching _pieces_per_pack_unit.
                    const availableOwnUnit = openContainerMode ? stock : stock / (activeItem.unitQuantity || 1);
                    // "boxes"/"rolls" only when this variant is actually packaged (a real
                    // pack of N units) — an unpackaged variant's own unit (e.g. "pcs") is
                    // the whole sale unit, not a pack, same distinction the price label
                    // below makes.
                    const unitLabel = canSellUnits ? packPlural(packNoun) : (activeItem.unit || 'units');
                    if (qty > availableOwnUnit) { finalError = `Only ${availableOwnUnit} ${unitLabel} available`; isValid = false; }
                    // A sealed pack with no price of its own can't be sold at zero --
                    // in open-container mode whole packs are the primary sale, so a
                    // missing price is a setup error worth surfacing at the till
                    // rather than silently billing nothing.
                    else if (openContainerMode && !canSellWholePack) {
                        finalError = `No whole-${packNoun.toLowerCase()} price set for this option — add one in Manage Variants`;
                        isValid = false;
                    }
                    lineItems.push({ type: 'accessory-unit', label: `Full ${packNoun}`, qty, rate: price, total, meta: { unit: activeItem.unit } });
                }
            }
            // On a sub-pack sale the pack's own size ("100m", "1000pcs") is not
            // what is being sold, and showing it next to the quantity in the cart
            // invites a cashier to cut the whole roll. It stays on a whole-pack
            // sale, where it IS the thing being sold and identifies which pack.
            // The attribute carrying the pack size is the one pooling ignores —
            // same rule as utils/poolKey.js.
            const packSizeAttrs = new Set(
                product.poolIgnoredAttributes != null
                    ? product.poolIgnoredAttributes
                    : Object.keys(selections).filter(k => k === 'Dimensions' || attributeTypesMap[k] === 'custom')
            );
            const shownAttributes = (openContainerMode && effectiveSaleUnit === 'pcs')
                ? attributesDetail.filter(a => !packSizeAttrs.has(a.label))
                : attributesDetail;
            onUpdate(total, { lineItems, attributes: shownAttributes, qty, salesMode, saleUnit: effectiveSaleUnit, selectedRoll, variantId: activeItem.variantId || activeItem.id, isValid, warning: finalError });
        }
        setError(finalError);
    }, [hasVariants, selectedVariant, product, selections, qtyFull, qtyHalf, cutLength, qty, salesMode, saleUnit, selectedRoll, hasRollOption, onUpdate, attributeTypesMap, openContainerMode, hasOpenPack]);

    const handleVariantSelect = (key, val) => setSelections(prev => ({ ...prev, [key]: val }));
    const activeItem = selectedVariant || product;
    const trackOffcuts = activeItem.trackOffcuts || activeItem.track_offcuts || product.trackOffcuts || product.track_offcuts;
    // Resolved against what's actually priced, so switching to a variant that
    // only supports one of the two modes lands on it without needing an effect.
    const saleOptions = saleOptionsFor(activeItem, openContainerMode);
    const { canSellWholePack, canSellUnits, wholePackPrice } = saleOptions;
    const canSellPcs = canSellUnits;   // kept for the counted-mode labels below
    const effectiveSaleUnit = resolveSaleUnit(saleUnit, saleOptions);
    const packNoun = packNounFor(activeItem.unit);
    const unitNoun = unitNounFor(activeItem.unit);
    // Same pooled-piece figure the validation effect above computes — see there for why.
    const displayPoolMembers = hasVariants && selectedVariant
        ? [selectedVariant, ...poolSiblings(product.variants, selectedVariant, attributeTypesMap, product.poolIgnoredAttributes)]
        : [activeItem];
    const displayPooledPieces = displayPoolMembers.reduce((sum, v) => sum + (v.stock || 0), 0);
    const packIsOpen = openContainerMode && hasOpenPack(product, hasVariants ? selectedVariant : null, attributeTypesMap);

    const chipBtn = (active, disabled = false) => ({
        padding: '0.3rem 0.875rem', borderRadius: '100px', fontSize: '0.72rem', fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer', border: '1px solid', transition: 'all 0.15s',
        background: active ? 'rgba(34,197,94,0.15)' : 'transparent',
        borderColor: active ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.1)',
        color: disabled ? '#334155' : active ? '#4ade80' : '#64748b',
        opacity: disabled ? 0.55 : 1,
    });

    return (
        <div>
            {/* Variant Attribute Selectors */}
            {hasVariants && Object.entries(availableAttributes).length > 0 && (
                <div style={sectionStyle}>
                    {Object.entries(availableAttributes).map(([key, options]) => (
                        <div key={key} style={{ marginBottom: '0.625rem' }}>
                            <span style={{ ...labelStyle, display: 'block', marginBottom: '0.375rem' }}>{key}</span>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                                {options.map(opt => (
                                    <button key={opt} onClick={() => handleVariantSelect(key, opt)} style={chipBtn(selections[key] === opt)}>{opt}</button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {trackOffcuts ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
                    {/* Standard lengths */}
                    <div style={sectionStyle}>
                        <p style={{ ...labelStyle, marginBottom: '0.875rem', display: 'block' }}>📏 Standard</p>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.625rem' }}>
                            <div>
                                <p style={{ fontSize: '0.82rem', color: '#94a3b8', margin: '0 0 2px', fontWeight: 600 }}>Full</p>
                                <p style={{ fontSize: '0.68rem', color: '#4ade80', fontFamily: 'var(--font-mono)', margin: 0 }}>KSH{activeItem.priceFull || activeItem.price || 0}/pc</p>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <button onClick={() => setQtyFull(Math.max(0, qtyFull - 1))} style={{ width: '30px', height: '30px', borderRadius: '7px', border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.07)', color: '#94a3b8' }}>-</button>
                                <input type="number" value={qtyFull === 0 ? '' : qtyFull} onChange={e => setQtyFull(e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value) || 0))} placeholder="0"
                                    style={{ ...inputStyle, width: '48px', textAlign: 'center', padding: '0.375rem' }} />
                                <button onClick={() => setQtyFull(qtyFull + 1)} style={{ width: '30px', height: '30px', borderRadius: '7px', border: 'none', cursor: 'pointer', background: 'rgba(34,197,94,0.15)', color: '#4ade80' }}>+</button>
                            </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.625rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                            <div>
                                <p style={{ fontSize: '0.82rem', color: '#94a3b8', margin: '0 0 2px', fontWeight: 600 }}>Half</p>
                                <p style={{ fontSize: '0.68rem', color: '#4ade80', fontFamily: 'var(--font-mono)', margin: 0 }}>KSH{activeItem.priceHalf || 0}/pc</p>
                            </div>
                            <button onClick={() => setQtyHalf(qtyHalf > 0 ? 0 : 1)} style={{
                                width: '44px', height: '24px', borderRadius: '100px', border: 'none', cursor: 'pointer', position: 'relative',
                                background: qtyHalf > 0 ? 'linear-gradient(135deg, #22c55e, #16a34a)' : 'rgba(255,255,255,0.1)', transition: 'background 0.2s',
                            }}>
                                <span style={{ position: 'absolute', top: '3px', left: qtyHalf > 0 ? '22px' : '3px', width: '18px', height: '18px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s', display: 'block' }} />
                            </button>
                        </div>
                    </div>

                    {/* Custom Cut */}
                    <div style={sectionStyle}>
                        <p style={{ ...labelStyle, marginBottom: '0.875rem', display: 'block' }}>✂️ Custom Cut</p>
                        <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '0 0 0.5rem', fontWeight: 500 }}>Length needed</p>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <input type="number" step="1" value={cutLength} onChange={e => setCutLength(e.target.value)} placeholder="0"
                                style={{ ...inputStyle, fontSize: '1.25rem', fontWeight: 700 }}
                                onFocus={e => { e.target.style.borderColor = 'rgba(34,197,94,0.5)'; }}
                                onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                            />
                            <span style={{ color: '#64748b', fontWeight: 700, flexShrink: 0 }}>{activeItem.unit || 'ft'}</span>
                        </div>
                        <p style={{ fontSize: '0.68rem', color: '#4ade80', fontFamily: 'var(--font-mono)', margin: '0.375rem 0 0', textAlign: 'right' }}>KSH{activeItem.priceUnit || activeItem.priceFoot || 0}/{activeItem.unit || 'unit'}</p>
                    </div>
                </div>
            ) : (
                /* Simple qty */
                <div style={{ ...sectionStyle, textAlign: 'center', padding: '1.5rem 1rem' }}>
                    {/* An open-container product always shows both choices, even when
                        one is unpriced, so it's obvious that selling a whole sealed
                        roll/box is still on the table — opening a pack to sell units
                        is an addition to that, never a replacement for it. */}
                    {(canSellUnits || openContainerMode) && !hasRollOption && (
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.375rem', marginBottom: '0.875rem' }}>
                            <button disabled={!canSellWholePack}
                                onClick={() => { setSaleUnit('box'); setQty(1); }}
                                style={chipBtn(effectiveSaleUnit === 'box', !canSellWholePack)}>
                                Full {packNoun}
                            </button>
                            <button disabled={!canSellUnits}
                                onClick={() => { setSaleUnit('pcs'); setQty(0); }}
                                style={chipBtn(effectiveSaleUnit === 'pcs', !canSellUnits)}>
                                {unitNoun}
                            </button>
                        </div>
                    )}
                    <p style={{ ...labelStyle, marginBottom: '1rem', display: 'block' }}>
                        {hasRollOption ? 'Number of Rolls'
                            : effectiveSaleUnit === 'pcs' ? unitNoun
                                : canSellUnits || openContainerMode ? `Number of ${packPlural(packNoun)}` : 'Quantity'}
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
                        <button onClick={() => setQty(Math.max(0, qty - 1))} style={{ width: '44px', height: '44px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', background: 'rgba(255,255,255,0.06)', color: '#94a3b8', fontSize: '1.25rem', fontWeight: 700 }}>-</button>
                        <input type="number" value={qty === 0 ? '' : qty} onChange={e => setQty(e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value) || 0))} placeholder="0"
                            style={{
                                fontSize: '2.5rem', fontWeight: 900, fontFamily: 'var(--font-mono)', color: '#f1f5f9',
                                width: '110px', textAlign: 'center', background: 'transparent', border: 'none', outline: 'none',
                            }} />
                        <button onClick={() => setQty(qty + 1)} style={{ width: '44px', height: '44px', borderRadius: '10px', border: 'none', cursor: 'pointer', background: 'rgba(34,197,94,0.15)', color: '#4ade80', fontSize: '1.25rem', fontWeight: 700 }}>+</button>
                    </div>
                    <p style={{ fontSize: '0.78rem', color: '#4ade80', fontFamily: 'var(--font-mono)', marginTop: '0.5rem' }}>
                        {effectiveSaleUnit === 'pcs'
                            ? `KSH${activeItem.priceUnit || 0} per ${activeItem.unit && activeItem.unit !== 'pcs' ? activeItem.unit : 'pc'}`
                            : `KSH${wholePackPrice} per ${canSellUnits || openContainerMode ? packNoun.toLowerCase() : (activeItem.unit || 'unit')}`}
                    </p>
                    {/* Named plainly rather than left as a silent zero: a pack with no
                        price of its own simply can't be sold whole until someone sets one. */}
                    {openContainerMode && !canSellWholePack && (
                        <p style={{ fontSize: '0.66rem', color: '#fbbf24', marginTop: '0.25rem', fontWeight: 600 }}>
                            No whole-{packNoun.toLowerCase()} price set — add one in Manage Variants to sell sealed {packPlural(packNoun)}.
                        </p>
                    )}
                    {canSellPcs && !openContainerMode && (
                        <p style={{ fontSize: '0.68rem', color: '#475569', marginTop: '0.25rem' }}>
                            1 Box = {activeItem.unitQuantity} pcs · {displayPooledPieces.toLocaleString()} pcs available
                        </p>
                    )}
                    {openContainerMode && (
                        /* Deliberately NOT a piece count: in this mode nothing
                           below a pack is tracked, so any figure here would be
                           a guess presented as fact. Show only what is known --
                           sealed packs on the shelf, and whether one is open. */
                        <p style={{ fontSize: '0.68rem', color: '#475569', marginTop: '0.25rem' }}>
                            {(activeItem.stock || 0).toLocaleString()} sealed {packPlural(packNoun)}
                            {activeItem.unitQuantity > 1 ? ` · labelled ${activeItem.unitQuantity}${product.unit || ''} each` : ''} · {packIsOpen
                                ? <span style={{ color: '#4ade80', fontWeight: 700 }}>1 open for {product.unit || 'units'}</span>
                                : <span style={{ color: '#fbbf24', fontWeight: 700 }}>none open</span>}
                        </p>
                    )}
                    {hasRollOption && <p style={{ fontSize: '0.68rem', color: '#475569', marginTop: '0.25rem' }}>Roll Length: {product.rollLength}m</p>}
                </div>
            )}

            {error && (
                <p style={{ fontSize: '0.7rem', color: '#f87171', fontWeight: 700, margin: '0.5rem 0 0', display: 'flex', alignItems: 'center', gap: '0.375rem', animation: 'pulse 1.5s ease-in-out infinite' }}>
                    <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    {error}
                </p>
            )}
        </div>
    );
});

export default AccessoryCalculator;
