import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { wsEvents } from '../utils/wsEvents';

/** CEO oversight: money received in the given period (day/month/year), broken
 * down by payment method, plus order volume/status counts for the same window. */
export function useFinancialSummary(period = 'day') {
    const [summary, setSummary] = useState(null);
    const [loading, setLoading] = useState(true);

    const fetchSummary = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.financialService.getSummary(period);
            setSummary(data);
        } catch (err) {
            console.error('Failed to fetch financial summary', err);
        } finally {
            setLoading(false);
        }
    }, [period]);

    useEffect(() => { fetchSummary(); }, [fetchSummary]);

    useEffect(() => {
        const off = wsEvents.on('orders_updated', fetchSummary);
        return off;
    }, [fetchSummary]);

    return { summary, loading };
}
