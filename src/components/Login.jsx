import { useState } from 'react';
import { supabase } from '../supabaseClient';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);

  const entrar = async (e) => {
    e.preventDefault();
    setCargando(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setCargando(false);
  };

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center px-4"
      style={{ background: '#12151A', color: '#E7E5E0', fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      <form onSubmit={entrar} className="w-full max-w-sm rounded-xl p-6" style={{ background: '#1B1F27', border: '1px solid #262B35' }}>
        <h1 className="text-xl font-bold mb-1">Itacen · Control de stock</h1>
        <p className="text-sm mb-5" style={{ color: '#8B8F98' }}>Ingresá con el usuario que te dio el gerente.</p>

        {error && (
          <div className="mb-4 px-3 py-2 rounded-lg text-sm" style={{ background: 'rgba(239,68,68,0.12)', color: '#FCA5A5' }}>
            {error}
          </div>
        )}

        <label htmlFor="login-email" className="block text-xs mb-1" style={{ color: '#8B8F98' }}>Email</label>
        <input
          id="login-email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full mb-3 rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: '#12151A', border: '1px solid #2A2F3A', color: '#E7E5E0' }}
        />

        <label htmlFor="login-password" className="block text-xs mb-1" style={{ color: '#8B8F98' }}>Contraseña</label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-5 rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: '#12151A', border: '1px solid #2A2F3A', color: '#E7E5E0' }}
        />

        <button
          type="submit"
          disabled={cargando}
          className="w-full py-2.5 rounded-lg font-medium text-sm"
          style={{ background: '#F2B705', color: '#0F1116' }}
        >
          {cargando ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
    </div>
  );
}
