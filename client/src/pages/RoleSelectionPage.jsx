import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import logo from '../assets/logo.png';

const roles = [
    {
        id: 'admin',
        title: 'CEO / Admin',
        description: 'Full access to overview, product management, and settings.',
        icon: '👑',
        color: 'from-amber-400 to-orange-500',
        shadow: 'shadow-orange-500/30'
    },
    {
        id: 'senior',
        title: 'Senior Cashier',
        description: 'Manage sales, inventory, and view reports.',
        icon: '💼',
        color: 'from-blue-500 to-indigo-600',
        shadow: 'shadow-blue-500/30'
    },
    {
        id: 'junior',
        title: 'Junior Cashier',
        description: 'Process sales and view basic overview.',
        icon: '👋',
        color: 'from-emerald-400 to-teal-500',
        shadow: 'shadow-emerald-500/30'
    }
];

export default function RoleSelectionPage() {
    const { updateUserRole } = useAuth();
    const navigate = useNavigate();

    const handleSelectRole = (roleId) => {
        updateUserRole(roleId);
        navigate('/');
    };

    return (
        <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6 relative overflow-hidden">

            {/* Ambient Background */}
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/20 rounded-full blur-[120px] animate-pulse-slow"></div>
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/20 rounded-full blur-[120px] animate-pulse-slow delay-1000"></div>

            <div className="relative z-10 w-full max-w-5xl">

                {/* Header */}
                <div className="text-center mb-16 animate-fade-in-down">
                    <img src={logo} alt="Logo" className="h-20 mx-auto mb-6 object-contain mix-blend-screen brightness-125" />
                    <h1 className="text-4xl font-bold text-white mb-3 tracking-tight">Welcome Back</h1>
                    <p className="text-gray-400 text-lg">Select your session role to continue</p>
                </div>

                {/* Cards Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    {roles.map((role, idx) => (
                        <button
                            key={role.id}
                            onClick={() => handleSelectRole(role.id)}
                            className="group relative bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 hover:bg-white/10 transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl text-left flex flex-col h-full"
                            style={{ animationDelay: `${idx * 100}ms` }}
                        >
                            {/* Gradient Border Effect on Hover */}
                            <div className={`absolute inset-0 rounded-3xl border-2 border-transparent group-hover:border-white/20 transition-all`}></div>

                            {/* Icon Box */}
                            <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${role.color} flex items-center justify-center text-3xl shadow-lg ${role.shadow} mb-8 group-hover:scale-110 transition-transform duration-300`}>
                                {role.icon}
                            </div>

                            <h3 className="text-2xl font-bold text-white mb-3 group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-white group-hover:to-gray-300 transition-all">
                                {role.title}
                            </h3>

                            <p className="text-gray-400 leading-relaxed group-hover:text-gray-300 transition-colors">
                                {role.description}
                            </p>

                            <div className="mt-auto pt-8 flex items-center text-sm font-bold tracking-wide uppercase text-white/40 group-hover:text-white transition-colors">
                                <span>Continue</span>
                                <svg className="w-5 h-5 ml-2 transform group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3"></path></svg>
                            </div>
                        </button>
                    ))}
                </div>

                <div className="text-center mt-12 text-white/20 text-sm font-medium">
                    &copy; 2025 EmiratesCo. All rights reserved.
                </div>

            </div>
        </div>
    );
}
