/**
 * Rounds a monetary amount UP to the nearest whole currency unit — the
 * business deals in whole KSH, not cents, so no amount shown or sent to the
 * backend should carry a fractional part.
 */
export function ceilAmount(value) {
    return Math.ceil(Number(value) || 0);
}
