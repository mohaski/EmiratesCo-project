import { useEffect, useRef, useState } from 'react';
import { extractErrorMessage } from '../utils/toast';

/** Debounced server dry run of an offcut-correction payload: { data, loading, error }.
 * The last answer stays visible while a newer one loads (so the replacement list doesn't
 * flicker); `loading` says it is stale. `enabled` false means nothing to preview. */
export default function useCorrectionPreview(fetcher, payload, enabled) {
    const key = JSON.stringify(payload);
    const [state, setState] = useState({ key: null, data: null, error: '' });
    const latest = useRef(key);

    useEffect(() => {
        latest.current = key;
        if (!enabled) return undefined;
        const timer = setTimeout(() => {
            fetcher(JSON.parse(key))
                .then(data => { if (latest.current === key) setState({ key, data, error: data?.error || '' }); })
                .catch(err => {
                    if (latest.current === key) {
                        setState({ key, data: null, error: extractErrorMessage(err, 'Could not preview this correction.') });
                    }
                });
        }, 400);
        return () => clearTimeout(timer);
    }, [key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!enabled) return { data: null, loading: false, error: '' };
    const loading = state.key !== key;
    return { data: state.data, loading, error: loading ? '' : state.error };
}
