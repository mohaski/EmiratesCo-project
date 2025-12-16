import { useState } from 'react';
import { Link } from 'react-router-dom';
import loginBg from '../assets/login-bg.png';
import logo from '../assets/logo.png';

export default function ForgotPassword() {
    const [email, setEmail] = useState('');
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (!email) {
            setError('Please enter your email address');
            return;
        }

        // 1. Start Loading
        setIsLoading(true);

        // 2. Simulate API Delay (e.g., 1.5 seconds)
        setTimeout(() => {
            console.log('Reset link sent to:', email);
            setIsLoading(false); // Stop loading
            setSubmitted(true);  // Show success message
        }, 1500);
    };

    return (
        <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
            {/* Background Image with Overlay */}
            <div
                className="absolute inset-0 z-0 bg-cover bg-center"
                style={{ backgroundImage: `url(${loginBg})` }}
            />
            <div className="absolute inset-0 z-0 bg-black/40 backdrop-blur-[3px]" />

            {/* Forgot Password Card */}
            <div className="w-full max-w-md p-8 rounded-2xl shadow-2xl relative z-10 mx-4 border border-white/10 bg-black/60 backdrop-blur-md">
                <div className="text-center mb-8 flex flex-col items-center">
                    <img
                        src={logo}
                        alt="EmiratesCo Logo"
                        className="h-24 mb-6 object-contain mix-blend-screen brightness-110 contrast-125 saturate-150"
                    />
                    <h1 className="text-2xl font-bold text-white mb-2 tracking-wide">Reset Password</h1>
                    <p className="text-gray-300 text-sm">Enter your email to receive a reset link</p>
                </div>

                {submitted ? (
                    <div className="text-center animate-fade-in">
                        <div className="mb-6 p-4 rounded-xl bg-green-500/20 border border-green-500/30 text-green-200">
                            <p>If an account exists for <strong>{email}</strong>, you will receive a reset link shortly.</p>
                        </div>
                        <Link
                            to="/login"
                            className="btn-primary w-full py-3 rounded-xl font-semibold text-white shadow-lg block text-center transform hover:scale-[1.02] transition-all"
                        >
                            Back to Login
                        </Link>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-6">
                        {error && (
                            <div className="p-3 rounded-lg bg-red-500/20 text-red-200 text-sm border border-red-500/30">
                                {error}
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">Email Address</label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="glass-input w-full px-4 py-3 rounded-xl focus:ring-2 focus:ring-blue-500/50 bg-white/10 text-white placeholder-gray-400 border-white/10 transition-all"
                                placeholder="name@company.com"
                                autoComplete="email"
                            />
                        </div>

                        {/* Flex Container for Button and Link */}
                        <div className="flex items-center justify-between gap-4">
                            <button
                                type="submit"
                                disabled={isLoading}
                                className={`btn-primary px-6 py-3 rounded-xl font-semibold text-white shadow-lg transform transition-all 
                                    ${isLoading ? 'opacity-70 cursor-wait' : 'active:scale-[0.98] hover:scale-[1.02]'}`}
                            >
                                {isLoading ? 'Sending...' : 'Send Reset Link'}
                            </button>

                            <Link
                                to="/login"
                                className="text-sm text-gray-400 hover:text-white transition-colors whitespace-nowrap"
                            >
                                Back to Login
                            </Link>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}