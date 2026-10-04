import { Navigate } from 'react-router-dom';

// The old page claimed "Your password has been updated" without calling the server (there
// is no reset-token flow). Any old link lands on the honest explanation instead.
export default function ResetPassword() {
    return <Navigate to="/forgot-password" replace />;
}
