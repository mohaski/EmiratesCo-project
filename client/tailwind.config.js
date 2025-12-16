/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                metal: {
                    100: 'var(--color-metal-100)',
                    200: 'var(--color-metal-200)',
                    300: 'var(--color-metal-300)',
                    400: 'var(--color-metal-400)',
                    500: 'var(--color-metal-500)',
                    600: 'var(--color-metal-600)',
                    700: 'var(--color-metal-700)',
                    800: 'var(--color-metal-800)',
                    900: 'var(--color-metal-900)',
                },
            }
        },
    },
    plugins: [],
}
