import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import loginBg from '../assets/login-bg.png';
import logo from '../assets/logo.png';

export default function Login() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const { login } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (!username || !password) {
            setError('Please enter both username and password');
            return;
        }

        setIsLoading(true);

        try {
            const success = await login(username, password);
            if (success) {
                navigate('/select-role');
            } else {
                setError('Invalid credentials');
            }
        } catch (err) {
            setError('Something went wrong. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
            {/* Background & Overlay */}
            <div
                className="absolute inset-0 z-0 bg-cover bg-center"
                style={{ backgroundImage: `url(${loginBg})` }}
            />
            <div className="absolute inset-0 z-0 bg-black/40 backdrop-blur-[3px]" />

            {/* Login Card */}
            <div className="w-full max-w-md p-8 rounded-2xl shadow-2xl relative z-10 mx-4 border border-white/10 bg-black/60 backdrop-blur-md">
                <div className="text-center mb-8 flex flex-col items-center">
                    <img
                        src={logo}
                        alt="EmiratesCo Logo"
                        className="h-32 mb-6 object-contain mix-blend-screen brightness-110 contrast-125 saturate-150"
                    />
                    <h1 className="text-3xl font-bold text-white mb-2 tracking-wide drop-shadow-md">EmiratesCo</h1>
                    <p className="text-gray-300 font-medium">Aluminium & Glass Company</p>
                </div>

                {/* Error Message */}
                {error && (
                    <div className="mb-6 p-3 rounded-lg bg-red-500/20 text-red-200 text-sm border border-red-500/30 flex items-center gap-2">
                        <span>⚠️</span> {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">Username</label>
                        <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="glass-input w-full px-4 py-3 rounded-xl focus:ring-2 focus:ring-blue-500/50 bg-white/10 text-white placeholder-gray-400 border-white/10"
                            placeholder="Enter your username"
                            autoComplete="username"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">Password</label>
                        <div className="relative">
                            <input
                                type={showPassword ? "text" : "password"}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="glass-input w-full px-4 py-3 rounded-xl focus:ring-2 focus:ring-blue-500/50 bg-white/10 text-white placeholder-gray-400 border-white/10 pr-12"
                                placeholder="••••••••"
                                autoComplete="current-password"
                            />

                            {/* Toggle Password Visibility Button */}
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                            >
                                {showPassword ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" /><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" /><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" /><line x1="2" x2="22" y1="2" y2="22" /></svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
                                )}
                            </button>
                        </div>
                    </div>

                    <div className="flex justify-end">
                        <Link to="/forgot-password" className="text-sm text-gray-400 hover:text-white transition-colors">
                            Forgot Password?
                        </Link>
                    </div>

                    <button
                        type="submit"
                        disabled={isLoading}
                        className={`btn-primary w-full py-3 rounded-xl font-semibold text-white shadow-lg transform transition-all 
                            ${isLoading ? 'opacity-70 cursor-wait' : 'active:scale-[0.98] hover:scale-[1.02]'}`}
                    >
                        {isLoading ? 'Signing In...' : 'Sign In'}
                    </button>
                </form>
            </div>
        </div>
    );
}