import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { wsEvents } from '../utils/wsEvents';

/** Shared aggregate of outstanding balances across all customers — backs the
 * CEO/Manager dashboard stat cards and the Dues page. */
export function useOutstandingCredits() {
    const [credits, setCredits] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchCredits = useCallback(async () => {
        try {
            const data = await api.financialService.getOutstandingCredits();
            setCredits(data);
        } catch (err) {
            console.error('Failed to fetch outstanding credits', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchCredits(); }, [fetchCredits]);

    useEffect(() => {
        const off = wsEvents.on('orders_updated', fetchCredits);
        return off;
    }, [fetchCredits]);

    const totalDue = credits.reduce((sum, c) => sum + c.amountDue, 0);

    return { credits, totalDue, count: credits.length, loading };
}
