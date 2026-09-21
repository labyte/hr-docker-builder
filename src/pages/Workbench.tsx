import { useEffect, useRef, useState } from 'react';
import EnvBanner from '../components/EnvBanner';
import Toolbar from '../components/Toolbar';
import ProjectSidebar from '../components/ProjectSidebar';
import ProgramTable from '../components/ProgramTable';
import ProgramFormModal from '../components/ProgramFormModal';
import SettingsModal from '../components/SettingsModal';
import AboutModal from '../components/AboutModal';
import LogPanel from '../components/LogPanel';
import { useStore } from '../store';
import type { Program } from '../types';

const PX_KEY = 'split-px';
const MIN_TOP = 120;
const MIN_BOT = 160;
const SPLITTER_H = 12;

export default function Workbench() {
  const refreshEnv = useStore((s) => s.refreshEnv);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Program | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  const splitRef = useRef<HTMLDivElement>(null);
  const [topPx, setTopPx] = useState<number | null>(() => {
    const saved = Number(localStorage.getItem(PX_KEY));
    return Number.isFinite(saved) && saved >= MIN_TOP ? saved : null;
  });
  const topPxRef = useRef(topPx);
  topPxRef.current = topPx;
  const draggingRef = useRef(false);

  useEffect(() => {
    void refreshEnv();
    const id = window.setInterval(() => {
      const s = useStore.getState();
      const need = !s.env || !s.env.dockerOk || !s.env.daemonOk || !s.env.builderOk;
      if (need && !s.envBusy) void s.refreshEnv();
    }, 3000);
    return () => window.clearInterval(id);
  }, [refreshEnv]);

  useEffect(() => {
    if (topPx === null && splitRef.current) setTopPx(Math.round(splitRef.current.getBoundingClientRect().height * 0.55));
  }, [topPx]);

  const onResize = () => {
    if (!splitRef.current || topPxRef.current === null) return;
    const h = splitRef.current.getBoundingClientRect().height;
    setTopPx(Math.min(topPxRef.current, Math.max(MIN_TOP, h - MIN_BOT - SPLITTER_H)));
  };
  useEffect(() => { window.addEventListener('resize', onResize); return () => window.removeEventListener('resize', onResize); });

  const clampPx = (y: number) => {
    const h = splitRef.current?.getBoundingClientRect().height ?? 600;
    return Math.round(Math.min(Math.max(MIN_TOP, y), Math.max(MIN_TOP, h - MIN_BOT - SPLITTER_H)));
  };

  return (
    <div className="page">
      <EnvBanner onOpenSettings={() => setSettingsOpen(true)} onOpenAbout={() => setAboutOpen(true)} />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ width: 240, flex: '0 0 240px', overflow: 'hidden' }}>
          <ProjectSidebar />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Toolbar onAddProgram={() => { setEditing(null); setFormOpen(true); }} />
          <div className="split" ref={splitRef}>
            <div className="left" style={{ height: topPx ?? '55%' }}>
              <ProgramTable onEdit={(p) => { setEditing(p); setFormOpen(true); }} />
            </div>
            <div className="splitter"
              onPointerDown={e => { e.preventDefault(); draggingRef.current = true; e.currentTarget.setPointerCapture(e.pointerId); }}
              onPointerMove={e => { if (!draggingRef.current || !splitRef.current) return; setTopPx(clampPx(e.clientY - splitRef.current.getBoundingClientRect().top)); }}
              onPointerUp={e => { if (!draggingRef.current) return; draggingRef.current = false; e.currentTarget.releasePointerCapture(e.pointerId); if (topPxRef.current !== null) localStorage.setItem(PX_KEY, String(topPxRef.current)); }}
              onDoubleClick={() => { if (splitRef.current) { setTopPx(clampPx(splitRef.current.getBoundingClientRect().height * 0.55)); localStorage.removeItem(PX_KEY); } }}
              title="拖动调整 / 双击复位"
            ><span className="splitter-grip" /></div>
            <div className="right"><LogPanel /></div>
          </div>
        </div>
      </div>
      <ProgramFormModal open={formOpen} initial={editing} onClose={() => setFormOpen(false)} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  );
}