import { Link } from 'react-router-dom';
import loginBg from '../assets/login-bg.png';
import logo from '../assets/logo.png';

// There is no email reset: the system has no mail service, and this page used to pretend
// to send a link (it only waited 1.5 s and said "sent"). Recovery is a person: an admin or
// the CEO resets the password from User Management, or — for the CEO's own account — the
// server's reset_user_password.py script. Either gives a temporary password that must be
// changed at the next sign-in.
export default function ForgotPassword() {
    return (
        <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
            <div
                className="absolute inset-0 z-0 bg-cover bg-center"
                style={{ backgroundImage: `url(${loginBg})` }}
            />
            <div className="absolute inset-0 z-0 bg-black/40 backdrop-blur-[3px]" />

            <div className="w-full max-w-md p-8 rounded-2xl shadow-2xl relative z-10 mx-4 border border-white/10 bg-black/60 backdrop-blur-md">
                <div className="text-center mb-6 flex flex-col items-center">
                    <img
                        src={logo}
                        alt="EmiratesCo Logo"
                        className="h-24 mb-6 object-contain mix-blend-screen brightness-110 contrast-125 saturate-150"
                    />
                    <h1 className="text-2xl font-bold text-white mb-2 tracking-wide">Forgot your password?</h1>
                </div>

                <div className="space-y-4 text-sm text-gray-200 leading-relaxed">
                    <p>
                        Ask your <strong>administrator or the CEO</strong> to reset it from
                        <strong> User Management</strong>. They will give you a temporary password.
                    </p>
                    <p>
                        Sign in with the temporary password — you will be asked to choose a new one
                        straight away.
                    </p>
                    <p className="text-gray-400 text-xs">
                        CEO locked out? The password can be reset on the server computer with
                        <code className="mx-1 px-1 rounded bg-white/10">python reset_user_password.py &lt;username&gt;</code>.
                    </p>
                </div>

                <Link
                    to="/login"
                    className="btn-primary w-full mt-8 py-3 rounded-xl font-semibold text-white shadow-lg block text-center transform hover:scale-[1.02] transition-all"
                >
                    Back to Login
                </Link>
            </div>
        </div>
    );
}
