/**
 * Parse a timestamp from the server.
 *
 * The server stores and sends wall-clock time in Africa/Nairobi (EAT, UTC+3) *without* a
 * zone suffix ("2026-10-04T11:58:44"). `new Date(thatString)` reads it as the BROWSER's
 * local time — right on a till set to Nairobi time, but hours off on any device that
 * isn't (and its Today/Yesterday grouping shifts with it). Strings that do carry a zone
 * ("…Z", "…+00:00") are left alone. Empty input gives an Invalid Date, exactly as
 * `new Date(undefined)` did, so callers that format it don't start throwing.
 */
const NAIROBI_OFFSET = '+03:00';
const HAS_ZONE = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const parseServerDate = (value) => {
    if (value == null || value === '') return new Date(NaN);
    if (value instanceof Date) return value;
    if (typeof value === 'number') return new Date(value);
    const s = String(value).trim();
    if (HAS_ZONE.test(s)) return new Date(s);
    if (DATE_ONLY.test(s)) return new Date(`${s}T00:00:00${NAIROBI_OFFSET}`);
    return new Date(`${s.replace(' ', 'T')}${NAIROBI_OFFSET}`);
};
