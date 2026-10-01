import { CutQuestions } from './ResolveCutsModal';

/** The panel a calculator shows above its inputs while an item of an order being edited
 *  differs from what's saved (see hooks/useEditCutAnswers). */
export default function EditCutPanel({ editCuts }) {
    if (!editCuts?.active) return null;
    return (
        <div data-testid="edit-cut-panel" style={{
            background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.25)',
            borderRadius: '0.875rem', padding: '0.875rem', marginBottom: '0.75rem',
        }}>
            <p style={{ fontSize: '0.7rem', fontWeight: 800, color: '#fbbf24', margin: '0 0 0.5rem', letterSpacing: '0.04em' }}>
                ✂️ ORIGINAL CUT{editCuts.lines.length > 1 ? 'S' : ''} — WAS IT MADE?
            </p>
            <p style={{ fontSize: '0.68rem', color: '#94a3b8', margin: '0 0 0.625rem' }}>
                Answer before choosing material for the new size — it decides what comes back.
            </p>
            <CutQuestions lines={editCuts.lines} answers={editCuts.answers} onChange={editCuts.setAnswers} />
            {!editCuts.complete && (
                <p style={{ fontSize: '0.66rem', color: '#f59e0b', fontWeight: 700, margin: '0.5rem 0 0' }}>
                    Answer every question above to continue.
                </p>
            )}
        </div>
    );
}
