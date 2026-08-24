import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import Login from './components/Login';
import CargaDiariaView from './components/CargaDiariaView';
import PanelGerenciaView from './components/PanelGerenciaView';

export default function App() {
  const [sesion, setSesion] = useState(undefined); // undefined = todavia no se sabe
  const [modo, setModo] = useState('operario');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSesion(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nuevaSesion) => {
      setSesion(nuevaSesion);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (sesion === undefined) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center" style={{ background: '#12151A', color: '#8B8F98' }}>
        Cargando…
      </div>
    );
  }

  if (!sesion) {
    return <Login />;
  }

  return (
    <div className="min-h-screen w-full" style={{ background: '#12151A' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600&display=swap');
        .disp { font-family: 'Space Grotesk', sans-serif; }
        .mono { font-family: 'IBM Plex Mono', monospace; }
      `}</style>

      <div
        className="sticky top-0 z-50 flex items-center justify-between gap-1 px-3 py-2"
        style={{ background: '#0D0F13', borderBottom: '1px solid #262B35' }}
      >
        <div className="flex items-center gap-1">
          <button
            onClick={() => setModo('operario')}
            className="px-3 py-1.5 rounded-lg text-xs font-medium mono"
            style={{ background: modo === 'operario' ? '#F2B705' : 'transparent', color: modo === 'operario' ? '#0F1116' : '#8B8F98' }}
          >
            Carga diaria
          </button>
          <button
            onClick={() => setModo('gerente')}
            className="px-3 py-1.5 rounded-lg text-xs font-medium mono"
            style={{ background: modo === 'gerente' ? '#F2B705' : 'transparent', color: modo === 'gerente' ? '#0F1116' : '#8B8F98' }}
          >
            Panel de gerencia
          </button>
        </div>
        <button
          onClick={() => supabase.auth.signOut()}
          className="px-2 py-1 rounded-lg text-xs"
          style={{ color: '#6B7280' }}
        >
          Salir ({sesion.user.email})
        </button>
      </div>

      {modo === 'operario' ? <CargaDiariaView /> : <PanelGerenciaView />}
    </div>
  );
}
