import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import { wsEvents } from '../utils/wsEvents';

/** CEO oversight: money received in the given period (day/month/year), broken
 * down by payment method, plus order volume/status counts for the same window. */
export function useFinancialSummary(period = 'day') {
    const [summary, setSummary] = useState(null);
    const [loading, setLoading] = useState(true);
    // Latest request wins: switching Day -> Month quickly could otherwise let the slower
    // "day" answer land under the "month" label.
    const reqRef = useRef(0);

    const fetchSummary = useCallback(async ({ silent = false } = {}) => {
        const req = ++reqRef.current;
        if (!silent) setLoading(true);
        try {
            const data = await api.financialService.getSummary(period);
            if (req === reqRef.current) setSummary(data);
        } catch (err) {
            console.error('Failed to fetch financial summary', err);
        } finally {
            if (req === reqRef.current) setLoading(false);
        }
    }, [period]);

    useEffect(() => { fetchSummary(); }, [fetchSummary]);

    // Background refresh on every order change — quietly, without blanking the figures.
    useEffect(() => wsEvents.on('orders_updated', () => fetchSummary({ silent: true })), [fetchSummary]);

    return { summary, loading };
}
