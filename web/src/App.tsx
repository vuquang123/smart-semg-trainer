import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CloudOff,
  Edit3,
  FlaskConical,
  Gauge,
  History,
  Info,
  Leaf,
  Link,
  LoaderCircle,
  LogOut,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Smartphone,
  Square,
  Target,
  Trash2,
  Trophy,
  UserRound,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { TrainerController } from './core/controller';
import {
  defaults,
  settingsSchema,
  isActive,
  isFreeMode,
  isTerminal,
  modeLabel,
  muscleLabel,
  sameSettings,
  stateLabels,
  uid,
  type SessionRecord,
  type Settings,
  type TrainingMode,
} from './core/protocol';
import {
  channelText,
  type Muscle,
} from './core/channelMap';
import { MockTransport } from './transports/mock';
import { WebSocketTransport } from './transports/websocket';
import { formatDeviceUrl } from './transports/firmwareMapper';
import { DEFAULT_TINYJAMBU_KEY_HEX } from './core/tinyjambu';
import { Repository } from './storage/repository';
import { CloudSync, supabase } from './storage/cloud';
import { ExportModal } from './components/ExportModal';
import { MuscleIllustration } from './components/MuscleIllustration';
import { AudioControls } from './components/AudioControls';
import { LatencyPanel } from './components/LatencyPanel';
import { useAudioFeedback } from './hooks/useAudioFeedback';
import type { TimeWindow } from './core/chartWindow';
import { SignalChart } from './components/SignalChart';
import { Modal, SaveBadge, duration, localDate } from './components/UI';
import { MobileTraining } from './components/MobileTraining';
import { FreeMeasure } from './components/FreeMeasure';
import { ActivationFeedback } from './components/ActivationFeedback';
import { TrainingSettings } from './components/TrainingSettings';
import { useMobileLayout } from './hooks/useMobileLayout';
import type { User } from '@supabase/supabase-js';

const HISTORY_PAGE_SIZE = 5;
const SESSION_MARKER_KEY = 'semg-session-marker';
const RAW_RECORDING_KEY = 'semg-raw-recording';

const reducedMotionPreference = () => {
  try {
    return localStorage.getItem('semg-reduced') === 'true';
  } catch {
    return false;
  }
};

type Tab = 'train' | 'history' | 'device' | 'profile';

const nav = [
  { id: 'train' as Tab, label: 'Tập luyện', icon: Activity },
  { id: 'history' as Tab, label: 'Lịch sử', icon: History },
  { id: 'device' as Tab, label: 'Thiết bị', icon: Smartphone },
  { id: 'profile' as Tab, label: 'Cá nhân', icon: UserRound },
];

const safeGet = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeSet = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Guest mode still works without preferences. */
  }
};

const readSettings = (): Settings => {
  try {
    const parsed = settingsSchema.safeParse({
      ...defaults,
      ...JSON.parse(safeGet('semg-settings') ?? '{}'),
      channel: 1,
    });
    return parsed.success ? { ...parsed.data, channel: 1 } : { ...defaults, channel: 1 };
  } catch {
    return { ...defaults, channel: 1 };
  }
};

export function App() {
  const mobile = useMobileLayout();
  const [settings, setSettings] = useState<Settings>(() => readSettings());
  const [repository] = useState(() => new Repository());
  const [controller] = useState(() => new TrainerController(repository, safeGet(RAW_RECORDING_KEY) === 'true'));
  const [mock] = useState(() => new MockTransport(1, readSettings()));
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const f = view.frame;
  const toggleRawRecording = useCallback(
    (enabled: boolean) => {
      safeSet(RAW_RECORDING_KEY, String(enabled));
      controller.setRawRecording(enabled);
    },
    [controller]
  );

  const audio = useAudioFeedback(
    f,
    view.live && view.connection === 'connected',
    view.diagnostics.sample_age_ms
  );

  const [tab, setTab] = useState<Tab>('train');
  const [welcome, setWelcome] = useState(() => !safeGet('semg-onboarded'));
  const [help, setHelp] = useState(false);
  const [install, setInstall] = useState(false);
  const [audioOpen, setAudioOpen] = useState(false);

  const [deviceSourceChoice, setDeviceSourceChoice] = useState<'simulation' | 'hardware'>(() =>
    controller.adapter?.kind === 'websocket' ? 'hardware' : 'simulation'
  );
  const [showPairingForm, setShowPairingForm] = useState(false);

  // History state & pagination (5 per page)
  const [records, setRecords] = useState<SessionRecord[]>([]);
  const [selected, setSelected] = useState<SessionRecord | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'completed' | 'stopped'>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'simulation' | 'replay' | 'sensor'>('all');
  const [historyPage, setHistoryPage] = useState(1);
  const [exportModalTarget, setExportModalTarget] = useState<{
    record: SessionRecord;
    sessions?: SessionRecord[];
  } | null>(null);

  // Profile & account state
  const [url, setUrl] = useState(() => safeGet('semg-ws-url') || '');
  const [aeadKey, setAeadKey] = useState(() => safeGet('semg-aead-key') || DEFAULT_TINYJAMBU_KEY_HEX);
  const [displayName, setDisplayName] = useState(() => safeGet('semg-display-name') || 'Người tập');
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(displayName);
  const [profileSection, setProfileSection] = useState<'account' | 'display' | 'about' | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [reduced, setReduced] = useState(() => safeGet('semg-reduced') === 'true');
  const [dev, setDev] = useState(false);
  const [faultDelay, setFaultDelay] = useState(false);
  const [showDevTools] = useState(() => new URLSearchParams(window.location.search).get('dev') === '1');
  const [standalone] = useState(() => window.matchMedia('(display-mode: standalone)').matches);
  const [offlineReady, setOfflineReady] = useState(false);

  const startRequest = useRef(0);
  const autoStart = useRef(false);
  const lastPersisted = useRef(0);
  const owner = useRef<string | undefined>(undefined);
  owner.current = user?.id;

  const cloud = useMemo(() => (supabase ? new CloudSync(repository, supabase) : null), [repository]);

  const refresh = useCallback(async () => {
    try {
      setRecords(await repository.all(owner.current));
    } catch {
      setNotice('Không mở được lịch sử trên máy. Hãy kiểm tra dung lượng hoặc quyền lưu của trình duyệt.');
    }
  }, [repository]);

  const sync = useCallback(async () => {
    if (!cloud || !owner.current) return;
    setSyncing(true);
    try {
      await cloud.sync(owner.current);
      setSyncMessage('Lịch sử đã được đối chiếu với tài khoản.');
      await refresh();
    } catch {
      setSyncMessage('Chưa đồng bộ được. Kết quả vẫn ở trên máy và sẽ được thử lại.');
    } finally {
      setSyncing(false);
    }
  }, [cloud, refresh]);

  const beginTraining = useCallback(async () => {
    const token = ++startRequest.current;
    const go = await audio.prepare();
    const current = controller.getSnapshot();
    if (go && token === startRequest.current && current.connection === 'connected' && current.frame?.state === 'ready') {
      await controller.command('start', settings);
    }
  }, [audio.prepare, controller, settings]);

  const connectMock = async () => {
    try {
      await controller.connect(controller.adapter === mock ? undefined : mock);
      setDeviceSourceChoice('simulation');
      setShowPairingForm(false);
      setNotice('Đã bật nguồn tín hiệu mô phỏng (không cần gắn điện cực).');
    } catch (e) {
      setNotice((e as Error).message);
    }
  };

  // Mount & reload state recovery
  useEffect(() => {
    void refresh();
    let mounted = true;
    if (safeGet('semg-onboarded')) {
      void repository
        .all()
        .then(async saved => {
          if (!mounted) return;
          let marker: { id?: string; state?: string; channel?: number } | null = null;
          try {
            marker = JSON.parse(safeGet(SESSION_MARKER_KEY) ?? 'null');
          } catch {
            marker = null;
          }
          const shouldRestore = !marker || marker.state !== 'idle';
          const last = shouldRestore
            ? saved.find(
                r =>
                  r.adapter_kind === 'mock' &&
                  r.snapshot.source === 'simulation' &&
                  (!marker?.id || r.id === marker.id)
              )
            : undefined;
          if (last) {
            mock.engine.restore(last.snapshot);
            setSettings({ ...last.snapshot.settings, channel: 1 });
          }
          await controller.connect(mock, last);
        })
        .catch(() => {
          if (mounted) void controller.connect(mock).catch(() => {});
        });
    }
    const onOnline = () => {
      setOnline(true);
      void sync();
    };
    const onOffline = () => setOnline(false);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && controller.adapter) {
        void controller
          .connect()
          .then(() => controller.command('get_state'))
          .catch(() => {});
        void refresh();
      }
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') void controller.flush();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('visibilitychange', onHide);
    const timer = setInterval(() => void sync(), 15000);
    const sub = supabase?.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      owner.current = session?.user.id;
      queueMicrotask(() => {
        void refresh();
        if (session) void sync();
      });
    });
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.ready.then(() => setOfflineReady(true)).catch(() => {});
    }
    return () => {
      mounted = false;
      clearInterval(timer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('visibilitychange', onHide);
      sub?.data.subscription.unsubscribe();
      controller.destroy();
    };
  }, [controller, mock, refresh, sync]);

  // Persist settings & session marker
  useEffect(() => {
    safeSet('semg-settings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    if (!f) return;
    if (f.source === 'simulation') {
      safeSet(
        SESSION_MARKER_KEY,
        JSON.stringify({ id: f.session_id, state: f.state, channel: f.selected_channel })
      );
    }
    // Keep settings synchronized when handshake/reset/calibrate frame arrives
    if ((f.cause === 'state' || f.cause === 'reset') && !view.pending) {
      const expectedMuscle = f.settings.muscle;
      if (settings.channel !== 1 || settings.muscle !== expectedMuscle) {
        setSettings(prev => ({
          ...prev,
          ...f.settings,
          channel: 1,
          muscle: expectedMuscle,
        }));
      }
    }
  }, [f?.session_id, f?.state, f?.cause, f?.settings.muscle, view.pending, settings.channel, settings.muscle]);

  useEffect(() => {
    safeSet('semg-ws-url', url.trim());
  }, [url]);
  useEffect(() => {
    safeSet('semg-aead-key', aeadKey.trim());
  }, [aeadKey]);
  useEffect(() => {
    safeSet('semg-display-name', displayName.trim() || 'Người tập');
  }, [displayName]);
  useEffect(() => {
    document.documentElement.dataset.reduce = String(reduced);
    safeSet('semg-reduced', String(reduced));
  }, [reduced]);
  useEffect(() => {
    if (f?.state === 'ready' && autoStart.current && !view.pending) {
      autoStart.current = false;
      void beginTraining();
    }
    if (f && isTerminal(f.state)) autoStart.current = false;
  }, [f?.state, view.pending, controller, settings, beginTraining]);
  useEffect(() => {
    if (view.savedAt && view.savedAt !== lastPersisted.current) {
      lastPersisted.current = view.savedAt;
      void refresh();
    }
  }, [view.savedAt, refresh]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(t);
  }, [notice]);

  // Reset history pagination to page 1 when filters change
  useEffect(() => {
    setHistoryPage(1);
  }, [filter, sourceFilter]);

  const delayed = isActive(f?.state) && (view.diagnostics.sample_age_ms ?? 0) > 500;
  const active = isActive(f?.state) || audio.countdown !== null;
  const terminal = isTerminal(f?.state);
  const connected = view.connection === 'connected' && view.live;

  // Unified authoritative settings and single-channel CH1 identity
  const currentSettings: Settings = active || terminal ? (f?.settings ?? settings) : settings;
  const activeChannel = 1 as const;
  const activeMuscle: Muscle = currentSettings.muscle;
  const free = isFreeMode(currentSettings);
  const contracting =
    connected && !delayed && f?.state === 'training' && !f?.paused && (f?.phase === 'contract' || f?.phase === 'hold');
  const valid = f?.valid_count ?? 0;
  const total = f?.total_count ?? 0;
  const failedAttempts = Math.max(0, total - valid);
  const goal = currentSettings.target;
  const pct = Math.min(100, (valid / goal) * 100);
  const isSimulation = !f || f.source === 'simulation';

  // Filtered & Paginated History
  const history = useMemo(
    () =>
      records.filter(
        r =>
          (filter === 'all' || r.snapshot.state === filter) &&
          (sourceFilter === 'all' || r.snapshot.source === sourceFilter)
      ),
    [records, filter, sourceFilter]
  );
  const totalHistory = history.length;
  const totalPages = Math.max(1, Math.ceil(totalHistory / HISTORY_PAGE_SIZE));
  const safePage = Math.min(historyPage, totalPages);
  const pageStartIndex = (safePage - 1) * HISTORY_PAGE_SIZE;
  const pagedHistory = history.slice(pageStartIndex, pageStartIndex + HISTORY_PAGE_SIZE);
  const shownStart = totalHistory === 0 ? 0 : pageStartIndex + 1;
  const shownEnd = Math.min(totalHistory, pageStartIndex + pagedHistory.length);

  const applySettings = async (nextRaw: Settings): Promise<boolean> => {
    if (active || view.pending) return false;
    const next: Settings = { ...nextRaw, channel: 1 };
    if (connected && f && (terminal || !sameSettings(f.settings, next))) {
      controller.clearError();
      const ok = await controller.command('reset', next);
      if (ok) {
        setSettings(next);
        setSelected(null);
        setNotice(`Đã áp dụng thiết lập (${channelText(1, next.muscle)}).`);
        return true;
      } else {
        controller.clearError();
        setNotice('Chưa áp dụng được thiết lập lên thiết bị. Đã giữ cấu hình hợp lệ trước đó.');
        return false;
      }
    }
    if (!connected && (!controller.adapter || controller.adapter === mock)) {
      mock.engine.execute({
        type: 'command',
        protocol: 1,
        command_id: uid(),
        session_id: mock.engine.frame.session_id,
        action: 'reset',
        settings: next,
      });
    }
    setSettings(next);
    setNotice('Đã áp dụng thiết lập buổi tập.');
    return true;
  };

  const changeMode = async (nextMode: TrainingMode) => {
    if (active || view.pending) return;
    const next: Settings = {
      ...settings,
      channel: 1,
      mode: nextMode === 'free' ? 'free' : undefined,
    };
    await applySettings(next);
  };

  const start = async () => {
    if (view.pending || audio.countdown !== null) return;
    audio.unlock();
    autoStart.current = true;
    const targetSettings: Settings = { ...settings, channel: 1 };
    if (!connected) {
      try {
        await controller.connect(controller.adapter ?? mock);
      } catch {
        autoStart.current = false;
        return;
      }
    }
    let current = controller.getSnapshot().frame;
    if (current && isTerminal(current.state)) {
      if (!(await controller.command('reset', targetSettings))) {
        autoStart.current = false;
        return;
      }
      current = controller.getSnapshot().frame;
    }
    if (current?.state === 'ready' && sameSettings(current.settings, targetSettings)) {
      autoStart.current = false;
      await beginTraining();
    } else if (!(await controller.command('calibrate', targetSettings))) {
      autoStart.current = false;
    }
  };

  const pauseResume = () => {
    if (view.pending || !connected || f?.state !== 'training') return;
    void controller.command(f.paused ? 'resume' : 'pause');
  };

  const resetCounter = async () => {
    if (view.pending || !connected) return;
    autoStart.current = false;
    startRequest.current++;
    audio.cancel();
    if (terminal) {
      if (await controller.command('reset', settings)) {
        setSelected(null);
        setNotice('Đã tạo phiên mới. Lịch sử các phiên trước vẫn được giữ.');
      }
    } else if (await controller.command('reset_counter')) {
      setNotice('Đã đặt lại bộ đếm về 0. Lịch sử các phiên trước vẫn được giữ.');
    }
  };

  const stop = () => {
    autoStart.current = false;
    startRequest.current++;
    audio.cancel();
    void controller.command('stop');
  };

  const newSession = async () => {
    autoStart.current = false;
    startRequest.current++;
    audio.cancel();
    const targetSettings: Settings = { ...settings, channel: 1 };
    if (await controller.command('reset', targetSettings)) {
      setSelected(null);
      setTab('train');
      setNotice('Đã tạo buổi tập mới. Lịch sử cũ vẫn được giữ.');
    }
  };

  const finishWelcome = async (mode: 'mock' | 'device') => {
    safeSet('semg-onboarded', 'true');
    setWelcome(false);
    if (mode === 'mock') await connectMock();
    else {
      setDeviceSourceChoice('hardware');
      setShowPairingForm(true);
      setTab('device');
    }
  };

  const sendLogin = async () => {
    if (!supabase) return;
    setAuthBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      setNotice('Đã gửi liên kết đăng nhập. Hãy kiểm tra email của bạn.');
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setAuthBusy(false);
    }
  };

  const remove = async () => {
    if (!deleteId) return;
    try {
      await repository.remove(deleteId);
      setDeleteId(null);
      setSelected(null);
      await refresh();
      void sync();
      setNotice('Đã xóa buổi tập.');
    } catch {
      setNotice('Chưa xóa được buổi tập. Vui lòng thử lại.');
    }
  };

  const phaseTitle =
    !connected && f
      ? free
        ? 'Mất kết nối · Ngừng cập nhật số đếm'
        : 'Chưa xác nhận trạng thái thiết bị'
      : audio.countdown !== null
        ? `Bắt đầu sau ${audio.countdown}…`
        : f?.state === 'calibrating'
          ? 'Thả lỏng và giữ yên'
          : free
            ? f?.state === 'training'
              ? f.paused
                ? 'Đang tạm dừng đo'
                : contracting
                  ? 'Đang co cơ'
                  : 'Thả lỏng'
              : terminal
                ? 'Phiên đếm tự do đã kết thúc'
                : f?.state === 'error'
                  ? 'Hãy kiểm tra thiết bị'
                  : 'Sẵn sàng đếm tự do'
            : f?.state === 'completed'
              ? 'Bạn đã hoàn thành mục tiêu'
              : f?.state === 'stopped'
                ? 'Buổi tập đã kết thúc'
                : f?.state === 'error'
                  ? 'Hãy kiểm tra thiết bị'
                  : f?.state === 'training'
                    ? f.paused
                      ? 'Buổi tập đang tạm dừng'
                      : f.phase === 'hold'
                        ? f.settings.zone_enabled
                          ? f.target_zone === 'below'
                            ? 'Tăng mức co vào vùng'
                            : f.target_zone === 'above'
                              ? 'Giảm nhẹ mức co'
                              : 'Giữ mức này'
                          : 'Giữ cơ thêm một chút'
                        : f.phase === 'release'
                          ? 'Đủ thời gian, hãy thả lỏng'
                          : f.phase === 'contract'
                            ? 'Bây giờ, hãy co cơ'
                            : 'Thả lỏng cơ tay'
                    : 'Sẵn sàng cùng bạn';

  const phaseDescription =
    !connected && f && free
      ? 'Kết nối bị gián đoạn. Bộ đếm giữ nguyên tại thời điểm mất kết nối.'
      : audio.countdown !== null
        ? 'Chuẩn bị tư thế. Bạn có thể bấm Hủy để dừng.'
        : f?.state === 'calibrating'
          ? 'Để tay thoải mái trong vài giây để thiết bị ghi nhận mức nghỉ.'
          : free
            ? f?.state === 'training'
              ? f.paused
                ? 'Thời gian đo và bộ đếm đang tạm dừng. Nhấn Tiếp tục để đo tiếp.'
                : contracting
                  ? 'Thả lỏng cơ xuống dưới ngưỡng thả để hoàn tất 1 lần đếm.'
                  : 'Co cơ vượt ngưỡng rồi thả lỏng để ghi nhận 1 lần co cơ.'
              : terminal
                ? `Tổng cộng ${valid} lần co cơ trong ${duration(f?.duration_ms ?? 0)}.`
                : 'Đo liên tục không giới hạn số lượt và thời gian giữ.'
            : f?.state === 'training'
              ? f.paused
                ? 'Nhấn Tiếp tục để tập tiếp hoặc Kết thúc để lưu buổi tập.'
                : f.phase === 'hold'
                  ? `Giữ ${f.settings.zone_enabled ? 'liên tục trong vùng mục tiêu' : 'cơ'} ít nhất ${(f.settings.min_hold_ms / 1000).toLocaleString('vi-VN')} giây.`
                  : f.phase === 'release'
                    ? 'Lượt đạt sẽ được xác nhận ngay khi bạn thả lỏng cơ.'
                    : 'Co – giữ – thả theo nhịp hướng dẫn.'
              : f?.state === 'completed'
                ? 'Kết quả buổi tập đã được lưu vào Lịch sử.'
                : f?.state === 'stopped'
                  ? 'Các lượt đạt trước khi dừng đã được lưu lại.'
                  : 'Kiểm tra vị trí đặt điện cực trên kênh CH1 và nhấn Bắt đầu khi sẵn sàng.';

  const totalSavedSessions = records.length;
  const totalValidReps = records.reduce((s, r) => s + r.snapshot.valid_count, 0);
  const totalMinutes = Math.floor(records.reduce((s, r) => s + r.snapshot.duration_ms, 0) / 60000);

  return (
    <div className={`app-shell ${active ? 'has-active-session' : ''} ${tab === 'train' ? 'is-training-tab' : ''}`}>
      <aside className="sidebar">
        <a
          href="#"
          className="brand"
          onClick={e => {
            e.preventDefault();
            setTab('train');
          }}
          aria-label="SMART sEMG TRAINER"
        >
          <span className="brand-mark"><Activity size={25} /></span>
          <span><strong>SMART sEMG</strong><small>TRAINER</small></span>
        </a>
        <div className="nav-caption">KHÔNG GIAN CỦA BẠN</div>
        <nav aria-label="Điều hướng chính">
          {nav.map(n => (
            <button
              key={n.id}
              aria-current={tab === n.id ? 'page' : undefined}
              className={`nav-item ${tab === n.id ? 'active' : ''}`}
              onClick={() => {
                setTab(n.id);
                setSelected(null);
              }}
            >
              <n.icon size={20} />
              {n.label}
              {tab === n.id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="leaf-circle"><Leaf size={22} /></span>
          <h3>Đều đặn từng chút.</h3>
          <p>Đo trên 1 kênh CH1;<br />vùng cơ là vị trí đặt điện cực.</p>
          <span className="note-decoration" />
        </div>
        <button className="sidebar-help" onClick={() => setHelp(true)}>
          <BookOpen size={17} />Hướng dẫn điện cực & tập luyện
        </button>
        <div className="sidebar-foot">
          <span className="foot-dot" />SMART sEMG Trainer<small>Đo sEMG 1 kênh (CH1)</small>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="mobile-brand">
            <span className="brand-mark"><Activity size={19} /></span>
            <strong>{nav.find(n => n.id === tab)?.label ?? 'sEMG Trainer'}</strong>
          </div>
          <div className="desktop-only breadcrumb">
            Không gian luyện tập <ChevronRight size={14} />
            <span>{nav.find(n => n.id === tab)?.label}</span>
          </div>
          <div className="topbar-right">
            {tab === 'train' && (
              <button
                className="audio-toggle"
                onClick={() => setAudioOpen(true)}
                aria-label={audio.preferences.mode === 'off' ? 'Bật hoặc tùy chỉnh âm báo' : 'Tùy chỉnh âm báo đang bật'}
              >
                {audio.preferences.mode === 'off' ? <VolumeX size={20} /> : <Volume2 size={20} />}
              </button>
            )}
            <span className="local-status">
              <ShieldCheck size={15} />
              {online ? 'Dữ liệu lưu an toàn trên máy' : 'Đang ngoại tuyến'}
            </span>
            {mobile && tab === 'train' && (
              <button
                className="mobile-help-button"
                onClick={() => setHelp(true)}
                aria-label="Hướng dẫn điện cực và luyện tập"
              >
                <Info size={20} />
              </button>
            )}
            <button className="avatar" onClick={() => setTab('profile')} aria-label="Mở trang cá nhân">
              {user?.email?.[0]?.toUpperCase() ?? <UserRound size={18} />}
            </button>
          </div>
        </header>

        <main className="main-content">
          {!online && (
            <div className="alert neutral">
              <CloudOff size={18} />
              <span>Bạn đang ngoại tuyến. Mô phỏng và lịch sử trên máy vẫn hoạt động.</span>
            </div>
          )}
          {view.error && (
            <div className="alert error" role="alert">
              <Info size={19} />
              <span>{view.error}</span>
              <button
                onClick={() => {
                  void controller
                    .connect()
                    .then(() => controller.command('get_state'))
                    .catch(() => {});
                }}
              >
                Lấy lại trạng thái
              </button>
            </div>
          )}
          {delayed && view.connection === 'connected' && (
            <div className="alert neutral" role="status">
              <Info size={18} />
              <span>Dữ liệu đang đến chậm. Âm báo theo nhịp tạm ngưng; bạn vẫn có thể nhấn Kết thúc.</span>
            </div>
          )}
          {f?.warning && (
            <div className="alert neutral">
              <Info size={18} />
              <span>{f.warning}</span>
            </div>
          )}
          {f?.error && (
            <div className="alert error" role="alert">
              <Info size={18} />
              <span>{f.error}</span>
            </div>
          )}
          {view.storageError && (
            <div className="alert error" role="alert">
              <Info size={18} />
              <span>{view.storageError}</span>
              {view.record && (
                <button type="button" onClick={() => setExportModalTarget({ record: view.record! })}>
                  Xuất dữ liệu
                </button>
              )}
            </div>
          )}

          {/* TAB 1: TẬP LUYỆN */}
          {tab === 'train' &&
            (mobile ? (
              <MobileTraining
                countdown={audio.countdown}
                view={view}
                settings={settings}
                onSettingsChange={s => applySettings(s)}
                onModeChange={m => void changeMode(m)}
                phaseTitle={phaseTitle}
                phaseDescription={phaseDescription}
                onStart={() => void start()}
                onPauseResume={pauseResume}
                onResetCounter={() => void resetCounter()}
                onStop={stop}
                onNewSession={() => void newSession()}
                onResult={() => {
                  if (view.record) {
                    setSelected(view.record);
                    setTab('history');
                  }
                }}
                onDevice={() => setTab('device')}
                onCalibrate={() => {
                  autoStart.current = false;
                  void controller.command('calibrate', { ...settings, channel: 1 });
                }}
                onReconnect={() => void controller.connect().catch(() => {})}
                rawRecording={Boolean(view.rawRecordingEnabled)}
                onRawRecordingChange={toggleRawRecording}
                onExport={view.record ? () => setExportModalTarget({ record: view.record! }) : undefined}
              />
            ) : (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow date-label">
                      {new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}
                    </div>
                    <h1>
                      {free ? 'Đếm co cơ tự do' : 'Luyện tập theo nhịp của bạn'}
                      <span className="heading-dot">.</span>
                    </h1>
                    <p>
                      {free
                        ? 'Đo liên tục trên kênh CH1 và theo dõi số lần co–thả cơ theo thời gian thực.'
                        : 'Theo dõi tín hiệu sEMG kênh CH1; chọn vị trí đặt điện cực và luyện tập theo mục tiêu.'}
                    </p>
                  </div>
                  <div className="heading-actions">
                    <div className="segmented mode-switch-top" role="group" aria-label="Chọn chế độ tập luyện">
                      <button
                        type="button"
                        aria-pressed={!free}
                        disabled={active || !!view.pending}
                        onClick={() => void changeMode('training')}
                      >
                        <Target size={15} />Luyện tập
                      </button>
                      <button
                        type="button"
                        aria-pressed={free}
                        disabled={active || !!view.pending}
                        onClick={() => void changeMode('free')}
                      >
                        <Gauge size={15} />Đếm tự do
                      </button>
                    </div>
                    <button className="button subtle small desktop-only" onClick={() => setHelp(true)}>
                      <Info size={16} />Hướng dẫn
                    </button>
                  </div>
                </div>

                <div className="connection-strip">
                  <div className={`connection-symbol ${connected ? 'connected' : ''}`}>
                    {connected ? <Wifi size={20} /> : <WifiOff size={20} />}
                  </div>
                  <div className="connection-name">
                    <strong>
                      {f?.device_name ?? 'Chưa kết nối thiết bị'} · {channelText(activeChannel, activeMuscle)}
                    </strong>
                    <span>
                      {connected
                        ? isSimulation
                          ? 'Đang dùng tín hiệu mô phỏng · Không cần gắn điện cực'
                          : 'Đã kết nối cảm biến thật'
                        : view.connection === 'connecting'
                          ? 'Đang kết nối…'
                          : 'Chọn mô phỏng hoặc kết nối thiết bị của bạn'}
                    </span>
                  </div>
                  {isSimulation && (
                    <span className="badge simulation"><FlaskConical size={13} />Mô phỏng</span>
                  )}
                  <button className="text-button" onClick={() => setTab('device')}>
                    {connected ? 'Thiết bị' : 'Kết nối'}<ChevronRight size={15} />
                  </button>
                </div>

                <div className="training-grid">
                  {free ? (
                    <FreeMeasure
                      frame={f}
                      settings={{ ...currentSettings, channel: activeChannel, muscle: activeMuscle }}
                      connected={connected}
                      delayed={delayed}
                      pending={view.pending}
                      connecting={view.connection === 'connecting'}
                      countdown={audio.countdown}
                      saved={!!view.record && !!view.savedAt && !view.storageError}
                      hasRecord={!!view.record}
                      phaseTitle={phaseTitle}
                      phaseDescription={phaseDescription}
                      onStart={() => void start()}
                      onPauseResume={pauseResume}
                      onResetCounter={() => void resetCounter()}
                      onStop={stop}
                      onNewSession={() => void newSession()}
                      onExport={view.record ? () => setExportModalTarget({ record: view.record! }) : undefined}
                      onResult={() => {
                        if (view.record) {
                          setSelected(view.record);
                          setTab('history');
                        }
                      }}
                    />
                  ) : terminal ? (
                    <section className="card session-card session-complete compact-terminal-card" aria-label="Tổng kết buổi tập">
                      <div className="card-heading">
                        <span className="section-label"><Activity size={16} />TỔNG KẾT BUỔI TẬP</span>
                        <span className="status-pill"><CheckCircle2 size={13} />{f ? stateLabels[f.state] : 'Hoàn thành'}</span>
                      </div>
                      <div className="terminal-summary-grid">
                        <div className="terminal-summary-primary">
                          <span className="terminal-summary-label">Số lượt đạt mục tiêu</span>
                          <strong className="terminal-summary-value">{valid} <small>/ {goal} lượt</small></strong>
                          {total > 0 && (
                            <span className="metric-sub">
                              Tổng lần thử: {total} ({valid} đạt{failedAttempts > 0 ? `, ${failedAttempts} chưa đạt` : ''})
                            </span>
                          )}
                        </div>
                        <div className="terminal-summary-meta">
                          <div>
                            <span>Thời gian tập</span>
                            <strong>{duration(f?.duration_ms ?? 0)}</strong>
                          </div>
                          <div>
                            <span>Kênh & vị trí cơ</span>
                            <strong>{channelText(activeChannel, activeMuscle)}</strong>
                          </div>
                        </div>
                      </div>
                      <div className="session-buttons terminal-buttons">
                        <button
                          className="button primary"
                          disabled={!view.record}
                          onClick={() => {
                            if (view.record) {
                              setSelected(view.record);
                              setTab('history');
                            }
                          }}
                        >
                          <Trophy size={18} />Xem kết quả<ArrowRight size={18} />
                        </button>
                        <button
                          type="button"
                          className="button outline"
                          disabled={!view.record}
                          onClick={() => view.record && setExportModalTarget({ record: view.record })}
                        >
                          <ArrowDownToLine size={17} />Xuất dữ liệu
                        </button>
                        <button
                          className="button outline"
                          onClick={() => void newSession()}
                          disabled={!!view.pending || !connected}
                        >
                          <Plus size={17} />Buổi mới
                        </button>
                      </div>
                      {view.record && view.savedAt && !view.storageError && (
                        <div className="session-foot"><SaveBadge /></div>
                      )}
                    </section>
                  ) : (
                    <section className="card session-card">
                      <div className="card-heading">
                        <span className="section-label">
                          <Activity size={16} />BUỔI TẬP · {channelText(activeChannel, activeMuscle)}
                        </span>
                        <span className={`status-pill ${active && !f?.paused ? 'status-live' : ''}`}>
                          {active && connected && !f?.paused ? <span className="pulse-dot" /> : <span className="status-dot" />}
                          {!connected && f ? 'Mất kết nối' : f ? (f.paused ? 'Tạm dừng' : stateLabels[f.state]) : 'Sẵn sàng'}
                        </span>
                      </div>
                      <div className="session-center">
                        <div>
                          <div className="rep-number">
                            <strong>{valid}</strong>
                            <span>/ {goal}</span>
                          </div>
                          <div className="rep-caption">
                            Lượt đạt mục tiêu{total > 0 ? ` · Tổng lần thử: ${total}` : ''}
                          </div>
                        </div>
                        <MuscleIllustration
                          muscle={activeMuscle}
                          phase={f?.phase}
                          state={f?.state}
                          paused={f?.paused}
                          connected={connected && !delayed}
                        />
                      </div>
                      <div className="progress-label">
                        <span>Tiến độ lượt đạt</span>
                        <strong>{Math.round(pct)}%</strong>
                      </div>
                      <div
                        className="progress-track"
                        role="progressbar"
                        aria-label="Tiến độ lượt tập"
                        aria-valuenow={valid}
                        aria-valuemin={0}
                        aria-valuemax={goal}
                      >
                        <span style={{ width: `${pct}%` }} />
                      </div>
                      <div className="coach-message" aria-live="polite">
                        <span className="coach-icon"><Leaf size={20} /></span>
                        <div>
                          <h2>{phaseTitle}</h2>
                          <p>{phaseDescription}</p>
                        </div>
                      </div>
                      {active && <ActivationFeedback frame={f} live={connected && !delayed} />}
                      {total > 0 && (
                        <div className={`inline-last-rep ${f?.repetitions.at(-1)?.valid ? 'valid' : 'invalid'}`} role="status">
                          {f?.repetitions.at(-1)?.valid ? <CheckCircle2 size={14} /> : <Clock3 size={14} />}
                          Lần thử thứ {total}: {f?.repetitions.at(-1)?.valid ? 'Đạt mục tiêu' : f?.settings.zone_enabled ? 'Chưa đủ trong vùng' : 'Giữ chưa đủ'} · {((f?.last_hold_ms ?? 0) / 1000).toFixed(1)} giây
                        </div>
                      )}
                      {f?.state === 'calibrating' && (
                        <div className="calibration">
                          <span>Đang hiệu chuẩn <strong>{Math.round(f.calibration_progress * 100)}%</strong></span>
                          <div className="progress-track"><span style={{ width: `${f.calibration_progress * 100}%` }} /></div>
                        </div>
                      )}
                      {f?.state === 'training' && (
                        <div className="hold-meter">
                          <div>
                            <span>{f.settings.zone_enabled ? 'Giữ trong vùng (lâu nhất)' : 'Thời gian giữ'}</span>
                            <strong>
                              {((f.settings.zone_enabled ? (f.longest_in_zone_ms ?? 0) : f.current_hold_ms) / 1000).toFixed(1)} / {(f.settings.min_hold_ms / 1000).toFixed(1)} giây
                            </strong>
                          </div>
                          <div className="progress-track">
                            <span
                              style={{
                                width: `${connected ? Math.min(100, ((f.settings.zone_enabled ? (f.longest_in_zone_ms ?? 0) : f.current_hold_ms) / Math.max(1, f.settings.min_hold_ms)) * 100) : 0}%`,
                              }}
                            />
                          </div>
                        </div>
                      )}
                      <div className="session-stats">
                        <div>
                          <Clock3 size={17} />
                          <span>Thời gian tập<strong>{duration(f?.duration_ms ?? 0)}</strong></span>
                        </div>
                        <div>
                          <Target size={17} />
                          <span>Tổng lần thử<strong>{total} <small>lần (đạt {valid})</small></strong></span>
                        </div>
                      </div>
                      <div className="session-buttons">
                        {active ? (
                          <>
                            {f?.state === 'training' && (
                              <button
                                className="button subtle"
                                onClick={pauseResume}
                                disabled={!!view.pending || !connected}
                              >
                                {f.paused ? <Play size={17} fill="currentColor" /> : <Pause size={17} />}
                                {f.paused ? 'Tiếp tục' : 'Tạm dừng'}
                              </button>
                            )}
                            <button
                              className="button danger"
                              onClick={stop}
                              disabled={view.pending === 'stop' || !connected}
                            >
                              {view.pending === 'stop' ? <LoaderCircle className="spin" size={18} /> : <Square size={15} fill="currentColor" />}
                              {view.pending === 'stop' ? 'Đang kết thúc…' : 'Kết thúc'}
                            </button>
                          </>
                        ) : (
                          <button
                            className="button primary"
                            onClick={() => void start()}
                            disabled={!!view.pending || view.connection === 'connecting'}
                          >
                            {view.pending ? <LoaderCircle className="spin" size={18} /> : <Play size={18} fill="currentColor" />}
                            {view.pending ? 'Đang gửi lệnh…' : 'Bắt đầu'}
                            <ArrowRight size={18} />
                          </button>
                        )}
                      </div>
                      {active && view.record && (
                        <div className="active-export-inline">
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => setExportModalTarget({ record: view.record! })}
                          >
                            <ArrowDownToLine size={14} />Xuất dữ liệu (bản chụp đang chạy)
                          </button>
                        </div>
                      )}
                    </section>
                  )}

                  <div className="settings-column">
                    <section className="card setup-card">
                      <div className="card-heading">
                        <div>
                          <div className="eyebrow">CẤU HÌNH BUỔI TẬP</div>
                          <h2>{free ? 'Thiết lập đếm tự do' : 'Thiết lập buổi tập'}</h2>
                        </div>
                        <Settings2 size={18} />
                      </div>
                      <TrainingSettings
                        settings={currentSettings}
                        onChange={s => applySettings(s)}
                        onModeChange={m => void changeMode(m)}
                        state={f?.state}
                        pending={!!view.pending || audio.countdown !== null}
                        connected={connected}
                        rawRecording={Boolean(view.rawRecordingEnabled)}
                        onRawRecordingChange={toggleRawRecording}
                        onCalibrate={() => {
                          autoStart.current = false;
                          void controller.command('calibrate', { ...settings, channel: 1 });
                        }}
                      />
                    </section>
                  </div>

                  <SignalChart
                    samples={view.record?.samples ?? []}
                    frame={f}
                    live={connected && active && !f?.paused}
                    delayed={delayed}
                  />
                </div>
              </>
            ))}

          {/* TAB 2: LỊCH SỬ (5 BUỔI MỖI TRANG + XUẤT KẾT QUẢ RÕ PHẠM VI) */}
          {tab === 'history' && (
            <section className="history-screen" aria-label="Lịch sử luyện tập">
              <div className="page-heading compact-heading">
                <div>
                  <h1>Lịch sử luyện tập<span className="heading-dot">.</span></h1>
                  <p>Mới nhất trước · Chạm vào buổi tập để xem chi tiết và biểu đồ tín hiệu.</p>
                </div>
                <button
                  type="button"
                  className="button subtle small"
                  onClick={() => {
                    void refresh();
                    if (user) void sync();
                  }}
                >
                  <RefreshCw size={15} className={syncing ? 'spin' : ''} />Làm mới
                </button>
              </div>

              {selected ? (
                <SessionDetail
                  record={records.find(r => r.id === selected.id) ?? selected}
                  onBack={() => setSelected(null)}
                  onExport={rec => setExportModalTarget({ record: rec })}
                  onDelete={() => setDeleteId(selected.id)}
                />
              ) : (
                <>
                  {/* Filters */}
                  <div className="history-toolbar">
                    <div className="segmented" role="group" aria-label="Lọc trạng thái buổi tập">
                      <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
                        Tất cả ({records.length})
                      </button>
                      <button type="button" aria-pressed={filter === 'completed'} onClick={() => setFilter('completed')}>
                        Hoàn thành
                      </button>
                      <button type="button" aria-pressed={filter === 'stopped'} onClick={() => setFilter('stopped')}>
                        Đã dừng
                      </button>
                    </div>
                    <select
                      aria-label="Lọc nguồn dữ liệu"
                      value={sourceFilter}
                      onChange={e => setSourceFilter(e.target.value as typeof sourceFilter)}
                    >
                      <option value="all">Mọi nguồn ({records.length})</option>
                      <option value="simulation">Mô phỏng</option>
                      <option value="replay">Phát lại</option>
                      <option value="sensor">Thiết bị thật</option>
                    </select>
                  </div>

                  {/* Unified Export Toolbar */}
                  {records.length > 0 && (
                    <div className="card history-export-bar" aria-label="Xuất dữ liệu buổi tập">
                      <div className="export-scope-group">
                        <span className="export-label">
                          <ArrowDownToLine size={15} />
                          Báo cáo buổi tập (PDF / Excel) hoặc Dữ liệu nghiên cứu — RAW (ZIP)
                        </span>
                      </div>
                      <div className="export-btn-group">
                        <button
                          type="button"
                          className="button primary small"
                          disabled={(history.length || records.length) === 0}
                          onClick={() => {
                            const pool = history.length ? history : records;
                            if (pool[0]) setExportModalTarget({ record: pool[0], sessions: pool });
                          }}
                        >
                          <ArrowDownToLine size={14} />Xuất dữ liệu
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Paginated List (5 per page) */}
                  {pagedHistory.length > 0 ? (
                    <>
                      <div className="history-list" role="list">
                        {pagedHistory.map(r => {
                          const snap = r.snapshot;
                          const rFree = isFreeMode(snap.settings);
                          const statusLabel = isActive(snap.state)
                            ? 'Cần đối chiếu'
                            : rFree && snap.state === 'stopped'
                              ? 'Đã kết thúc'
                              : stateLabels[snap.state];
                          return (
                            <button
                              key={r.id}
                              type="button"
                              role="listitem"
                              className="card history-row-compact"
                              onClick={() => setSelected(r)}
                            >
                              <div className="history-row-left">
                                <div className="history-row-title">
                                  <strong>{channelText(snap.selected_channel, snap.settings.muscle)}</strong>
                                  <span className={`badge ${snap.state === 'completed' ? 'status-live' : 'neutral'}`}>
                                    {statusLabel}
                                  </span>
                                </div>
                                <div className="history-row-sub">
                                  <span>{localDate(snap.started_at)}</span>
                                  <span>· {modeLabel(snap.settings.mode)}</span>
                                  <span>· {snap.source === 'simulation' ? 'Mô phỏng' : snap.source === 'replay' ? 'Phát lại' : 'Thiết bị thật'}</span>
                                </div>
                              </div>
                              <div className="history-row-right">
                                <strong>
                                  {rFree
                                    ? `${snap.valid_count} lần`
                                    : `${snap.valid_count}/${snap.settings.target} lượt`}
                                </strong>
                                <span><Clock3 size={12} /> {duration(snap.duration_ms)}</span>
                              </div>
                              <ChevronRight size={18} className="history-chevron" />
                            </button>
                          );
                        })}
                      </div>

                      <div className="history-pagination" aria-label="Phân trang lịch sử">
                        <span className="pagination-count" role="status">
                          Hiển thị {shownStart}–{shownEnd} trên {totalHistory} buổi
                        </span>
                        <div className="pagination-controls">
                          <button
                            type="button"
                            className="button outline small"
                            disabled={safePage <= 1}
                            onClick={() => setHistoryPage(p => Math.max(1, p - 1))}
                          >
                            <ChevronLeft size={15} />Trước
                          </button>
                          <span className="pagination-page-indicator">
                            Trang <strong>{safePage}</strong>/{totalPages}
                          </span>
                          <button
                            type="button"
                            className="button outline small"
                            disabled={safePage >= totalPages}
                            onClick={() => setHistoryPage(p => Math.min(totalPages, p + 1))}
                          >
                            Sau<ChevronRight size={15} />
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="card empty-state">
                      <History size={32} />
                      <h2>{records.length ? 'Không có buổi tập phù hợp bộ lọc' : 'Chưa có buổi tập nào được lưu'}</h2>
                      <p>
                        {records.length
                          ? 'Hãy thử chọn lại bộ lọc Tất cả để xem toàn bộ lịch sử.'
                          : 'Hoàn thành buổi tập đầu tiên để xem lại kết quả và biểu đồ tại đây.'}
                      </p>
                      {records.length ? (
                        <button
                          type="button"
                          className="button outline"
                          onClick={() => {
                            setFilter('all');
                            setSourceFilter('all');
                          }}
                        >
                          Xem tất cả ({records.length} buổi)
                        </button>
                      ) : (
                        <button type="button" className="button primary" onClick={() => setTab('train')}>
                          <Play size={16} />Đến màn Tập luyện
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {/* TAB 3: THIẾT BỊ (THU GỌN, XÓA PHẦN KÊNH & VỊ TRÍ CƠ DƯ THỪA) */}
          {tab === 'device' && (
            <section className="device-screen" aria-label="Thiết bị đo sEMG">
              <div className="page-heading compact-heading">
                <div>
                  <h1>Thiết bị đo sEMG<span className="heading-dot">.</span></h1>
                  <p>Chọn nguồn tín hiệu, quản lý kết nối cảm biến và hiệu chuẩn mức nghỉ.</p>
                </div>
              </div>

              <section className="card device-compact-card" aria-label="Nguồn tín hiệu và kết nối">
                <div className="device-source-header">
                  <span className="field-label">Nguồn tín hiệu</span>
                  <div className="segmented" role="group" aria-label="Chọn nguồn tín hiệu">
                    <button
                      type="button"
                      aria-pressed={deviceSourceChoice === 'simulation' && controller.adapter === mock}
                      disabled={active || view.connection === 'connecting'}
                      onClick={() => void connectMock()}
                    >
                      <FlaskConical size={15} />Mô phỏng
                      {controller.adapter === mock && connected && <Check size={14} className="selected-check" />}
                    </button>
                    <button
                      type="button"
                      aria-pressed={deviceSourceChoice === 'hardware' || controller.adapter?.kind === 'websocket'}
                      disabled={active}
                      onClick={() => {
                        setDeviceSourceChoice('hardware');
                        setShowPairingForm(true);
                      }}
                    >
                      <Wifi size={15} />Thiết bị thật
                      {controller.adapter?.kind === 'websocket' && connected && <Check size={14} className="selected-check" />}
                    </button>
                  </div>
                </div>
                <p className="device-source-desc">
                  {controller.adapter?.kind === 'websocket'
                    ? 'Đang dùng cảm biến sEMG kết nối qua Wi-Fi (bảo mật TinyJAMBU-128 AEAD).'
                    : 'Đang dùng tín hiệu mô phỏng · Không cần gắn điện cực.'}
                </p>

                {/* Separate Connection Status vs Session Status */}
                <div className="device-status-split">
                  <div className="status-split-item">
                    <span>Trạng thái kết nối</span>
                    <strong className={connected ? 'text-ok' : 'text-warn'}>
                      <i className={`dot-inline ${connected ? 'ok' : ''}`} />
                      {connected
                        ? `Đã kết nối (${f?.device_name ?? 'Mô phỏng'})`
                        : view.connection === 'connecting'
                          ? 'Đang kết nối…'
                          : view.connection === 'lost'
                            ? 'Mất kết nối'
                            : 'Chưa kết nối'}
                    </strong>
                  </div>
                  <div className="status-split-item">
                    <span>Trạng thái buổi tập</span>
                    <strong>
                      {!f || f.state === 'idle'
                        ? 'Chưa bắt đầu'
                        : f.paused
                          ? 'Đang tạm dừng'
                          : stateLabels[f.state]}
                    </strong>
                  </div>
                </div>

                {connected && f?.source === 'sensor' && (
                  <div className="device-status-split" aria-label="Thông số quy đổi cảm biến">
                    <div className="status-split-item">
                      <span>Đơn vị &amp; Hệ số quy đổi</span>
                      <strong>
                        {f.unit === 'uV' ? 'µV' : f.unit}
                        {f.conversion ? ` · ${f.conversion.uV_per_unit.toFixed(2)} µV/count` : ''}
                        {f.conversion?.gain ? ` (G=${f.conversion.gain}×)` : ''}
                      </strong>
                    </div>
                    <div className="status-split-item">
                      <span>Hiệu chuẩn ADC</span>
                      <strong>
                        {f.conversion
                          ? f.conversion.calibrated === true
                            ? `eFuse Line Fitting (${(f.conversion.scale ?? 805.86).toFixed(1)} µV/LSB)`
                            : f.conversion.calibrated === false
                              ? `Mặc định (${(f.conversion.scale ?? 805.86).toFixed(2)} µV/LSB)`
                              : f.conversion.reference
                          : 'Số đếm ADC thô'}
                      </strong>
                    </div>
                  </div>
                )}

                {/* Hardware Pairing Form (Only open when hardware chosen or Manage Connection clicked) */}
                {(deviceSourceChoice === 'hardware' || controller.adapter?.kind === 'websocket') &&
                  (showPairingForm || !(controller.adapter?.kind === 'websocket' && connected)) ? (
                  <div className="pairing-form-box">
                    <div className="pairing-form-head">
                      <strong>Ghép nối cảm biến sEMG qua Wi-Fi</strong>
                      <span className="badge neutral"><ShieldCheck size={12} />AEAD 128-bit</span>
                    </div>
                    <label className="field-label" htmlFor="device-url">Địa chỉ IP hoặc tên thiết bị Wi-Fi</label>
                    <input
                      id="device-url"
                      type="text"
                      className="text-input"
                      value={url}
                      onChange={e => setUrl(e.target.value)}
                      onFocus={e => e.currentTarget.scrollIntoView({ block: 'nearest' })}
                      placeholder="Ví dụ: 192.168.1.55"
                      disabled={active}
                    />
                    <details className="security-details">
                      <summary>Nâng cao: Khóa bảo mật AEAD (mặc định tự động)</summary>
                      <label className="field-label" htmlFor="device-aead-key">Khóa ghép đôi (Hex / mật khẩu)</label>
                      <input
                        id="device-aead-key"
                        type="password"
                        className="text-input"
                        value={aeadKey}
                        onChange={e => setAeadKey(e.target.value)}
                        onFocus={e => e.currentTarget.scrollIntoView({ block: 'nearest' })}
                        placeholder="Nhập khóa nếu đã đổi trên firmware"
                        disabled={active}
                      />
                    </details>
                    <div className="pairing-actions">
                      <button
                        type="button"
                        className="button primary"
                        disabled={active || view.connection === 'connecting'}
                        onClick={() => {
                          const wsUrl = formatDeviceUrl(url);
                          if (!wsUrl) {
                            setNotice('Hãy nhập địa chỉ IP hoặc URL WebSocket của ESP32 (ví dụ: 192.168.1.55).');
                            return;
                          }
                          void controller
                            .connect(new WebSocketTransport(wsUrl, aeadKey.trim()))
                            .then(() => {
                              setShowPairingForm(false);
                              setNotice('Đã ghép nối thiết bị đo sEMG thành công.');
                            })
                            .catch(e => setNotice((e as Error).message));
                        }}
                      >
                        {view.connection === 'connecting' ? <LoaderCircle className="spin" size={16} /> : <Link size={16} />}
                        <span>{view.connection === 'connecting' ? 'Đang kết nối…' : 'Kết nối thiết bị'}</span>
                      </button>
                      {showPairingForm && (
                        <button
                          type="button"
                          className="button subtle"
                          onClick={() => {
                            setShowPairingForm(false);
                            if (controller.adapter === mock) setDeviceSourceChoice('simulation');
                          }}
                        >
                          Thu gọn
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="manage-conn-row">
                    <button
                      type="button"
                      className="button outline small"
                      disabled={active}
                      onClick={() => {
                        setDeviceSourceChoice('hardware');
                        setShowPairingForm(true);
                      }}
                    >
                      <Wifi size={14} />Quản lý kết nối Wi-Fi
                    </button>
                  </div>
                )}

                {/* Essential Device Actions */}
                <div className="device-quick-actions">
                  <button
                    type="button"
                    className="button primary"
                    onClick={() => setTab('train')}
                  >
                    <Play size={15} fill="currentColor" />Đến màn Tập luyện<ArrowRight size={15} />
                  </button>
                  <button
                    type="button"
                    className="button outline"
                    disabled={active || !connected || !!view.pending}
                    onClick={() => {
                      autoStart.current = false;
                      void controller.command('calibrate', { ...settings, channel: 1 });
                    }}
                  >
                    <RotateCcw size={15} />Hiệu chuẩn
                  </button>
                  <button
                    type="button"
                    className="button subtle"
                    onClick={() => setHelp(true)}
                  >
                    <BookOpen size={15} />Hướng dẫn điện cực
                  </button>
                </div>
              </section>
            </section>
          )}

          {/* TAB 4: CÁ NHÂN (THU GỌN THÀNH HÀNG HỒ SƠ + DANH SÁCH 6 MỤC) */}
          {tab === 'profile' && (
            <section className="profile-screen" aria-label="Không gian cá nhân">
              {/* Compact Profile Header Row */}
              <section className="card profile-compact-header">
                <div className="profile-header-top">
                  <span className="account-avatar-compact">
                    {user?.email?.[0]?.toUpperCase() ?? <UserRound size={22} />}
                  </span>
                  <div className="profile-header-text">
                    <strong>{displayName}</strong>
                    <span>{user ? user.email : 'Lưu trữ trực tiếp trên thiết bị'}</span>
                  </div>
                  <button
                    type="button"
                    className="button subtle small"
                    onClick={() => {
                      setNameDraft(displayName);
                      setEditingName(!editingName);
                    }}
                  >
                    <Edit3 size={14} />{editingName ? 'Đóng' : 'Sửa'}
                  </button>
                </div>

                {editingName && (
                  <form
                    className="profile-name-edit-form"
                    onSubmit={e => {
                      e.preventDefault();
                      const clean = nameDraft.trim() || 'Người tập';
                      setDisplayName(clean);
                      setEditingName(false);
                      setNotice('Đã cập nhật tên hiển thị.');
                    }}
                  >
                    <label className="field-label" htmlFor="profile-name-input">Tên hiển thị của bạn</label>
                    <div className="name-edit-row">
                      <input
                        id="profile-name-input"
                        type="text"
                        className="text-input"
                        value={nameDraft}
                        onChange={e => setNameDraft(e.target.value)}
                        placeholder="Nhập tên của bạn"
                      />
                      <button type="submit" className="button primary small">
                        <Check size={14} />Lưu
                      </button>
                    </div>
                  </form>
                )}

                <div className="profile-stats-mini">
                  <div>
                    <span>Buổi đã lưu</span>
                    <strong>{totalSavedSessions}</strong>
                  </div>
                  <div>
                    <span>Tổng lượt đạt</span>
                    <strong>{totalValidReps}</strong>
                  </div>
                  <div>
                    <span>Thời gian tập</span>
                    <strong>{totalMinutes} <small>phút</small></strong>
                  </div>
                </div>
              </section>

              {/* Compact 6-Item Menu List */}
              <div className="card profile-menu-list" role="list">
                {/* 1. Hồ sơ & Sao lưu */}
                <div className="profile-menu-item" role="listitem">
                  <button
                    type="button"
                    className="profile-menu-trigger"
                    aria-expanded={profileSection === 'account'}
                    onClick={() => setProfileSection(profileSection === 'account' ? null : 'account')}
                  >
                    <UserRound size={19} />
                    <div className="profile-menu-text">
                      <strong>Hồ sơ & Sao lưu</strong>
                      <small>{user ? `Đã liên kết: ${user.email}` : `Tên: ${displayName} · Lưu trên máy`}</small>
                    </div>
                    <ChevronRight size={17} className={profileSection === 'account' ? 'rotated' : ''} />
                  </button>
                  {profileSection === 'account' && (
                    <div className="profile-menu-content">
                      <div className="profile-inline-actions">
                        <button
                          type="button"
                          className="button outline small"
                          onClick={() => {
                            setNameDraft(displayName);
                            setEditingName(true);
                          }}
                        >
                          <Edit3 size={14} />Đổi tên hiển thị
                        </button>
                        <button
                          type="button"
                          className="button subtle small"
                          onClick={() => setTab('history')}
                        >
                          <ArrowDownToLine size={14} />Xuất dữ liệu tại Lịch sử
                        </button>
                      </div>
                      {user ? (
                        <div className="account-sync-box">
                          <span className="badge neutral"><CheckCircle2 size={13} />Đã liên kết đám mây</span>
                          <button
                            type="button"
                            className="button primary full-width"
                            onClick={() => void sync()}
                            disabled={syncing}
                          >
                            {syncing ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
                            Đồng bộ lịch sử ngay
                          </button>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => {
                              void supabase?.auth.signOut();
                              setSyncMessage('');
                            }}
                          >
                            <LogOut size={15} />Đăng xuất tài khoản
                          </button>
                        </div>
                      ) : supabase ? (
                        <form
                          onSubmit={e => {
                            e.preventDefault();
                            void sendLogin();
                          }}
                        >
                          <label className="field-label" htmlFor="email">Email sao lưu lịch sử</label>
                          <input
                            type="email"
                            id="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            required
                            placeholder="ban@example.com"
                          />
                          <button className="button primary full-width" type="submit" disabled={authBusy}>
                            {authBusy ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={16} />}
                            Nhận liên kết đăng nhập
                          </button>
                        </form>
                      ) : (
                        <p className="microcopy">
                          Mọi kết quả luyện tập được tự động lưu trữ an toàn trên trình duyệt của thiết bị này.
                        </p>
                      )}
                      {syncMessage && <p className="microcopy" role="status">{syncMessage}</p>}
                    </div>
                  )}
                </div>

                {/* 2. Âm báo & giọng hướng dẫn */}
                <div className="profile-menu-item" role="listitem">
                  <button
                    type="button"
                    className="profile-menu-trigger"
                    onClick={() => setAudioOpen(true)}
                  >
                    {audio.preferences.mode === 'off' ? <VolumeX size={19} /> : <Volume2 size={19} />}
                    <div className="profile-menu-text">
                      <strong>Âm báo & giọng hướng dẫn</strong>
                      <small>
                        {audio.preferences.mode === 'off'
                          ? 'Âm báo: Tắt'
                          : `Âm báo: ${audio.preferences.mode === 'voice' ? 'Giọng tiếng Việt' : 'Tiếng bíp'} · Âm lượng ${Math.round(audio.preferences.volume * 100)}%${audio.preferences.countdown ? ' · Đếm ngược 3-2-1' : ''}`}
                      </small>
                    </div>
                    <ChevronRight size={17} />
                  </button>
                </div>

                {/* 3. Hiển thị & chuyển động */}
                <div className="profile-menu-item" role="listitem">
                  <button
                    type="button"
                    className="profile-menu-trigger"
                    aria-expanded={profileSection === 'display'}
                    onClick={() => setProfileSection(profileSection === 'display' ? null : 'display')}
                  >
                    <Leaf size={19} />
                    <div className="profile-menu-text">
                      <strong>Hiển thị & chuyển động</strong>
                      <small>Giảm chuyển động: {reduced ? 'Bật' : 'Tắt'}</small>
                    </div>
                    <ChevronRight size={17} className={profileSection === 'display' ? 'rotated' : ''} />
                  </button>
                  {profileSection === 'display' && (
                    <div className="profile-menu-content">
                      <label className="toggle-row compact-toggle">
                        <span>
                          <strong>Giảm chuyển động</strong>
                          <small>Tắt hiệu ứng co giãn cơ và chuyển cảnh để mắt dễ chịu hơn.</small>
                        </span>
                        <input
                          type="checkbox"
                          role="switch"
                          checked={reduced}
                          onChange={e => setReduced(e.target.checked)}
                        />
                      </label>
                    </div>
                  )}
                </div>

                {/* 4. Thêm vào màn hình chính */}
                <div className="profile-menu-item" role="listitem">
                  <button
                    type="button"
                    className="profile-menu-trigger"
                    onClick={() => setInstall(true)}
                  >
                    <Smartphone size={19} />
                    <div className="profile-menu-text">
                      <strong>Thêm vào màn hình chính</strong>
                      <small>
                        {standalone
                          ? 'Đang mở dưới dạng ứng dụng'
                          : offlineReady
                            ? 'Sẵn sàng dùng ngoại tuyến'
                            : 'Hướng dẫn cài đặt nhanh'}
                      </small>
                    </div>
                    <ChevronRight size={17} />
                  </button>
                </div>

                {/* 5. Trợ giúp */}
                <div className="profile-menu-item" role="listitem">
                  <button
                    type="button"
                    className="profile-menu-trigger"
                    onClick={() => setHelp(true)}
                  >
                    <BookOpen size={19} />
                    <div className="profile-menu-text">
                      <strong>Trợ giúp</strong>
                      <small>
                        Hướng dẫn gắn điện cực CH1 ({muscleLabel(activeMuscle).toLowerCase()}) & cách tính lượt
                      </small>
                    </div>
                    <ChevronRight size={17} />
                  </button>
                </div>

                {/* 6. Thông tin ứng dụng */}
                <div className="profile-menu-item" role="listitem">
                  <button
                    type="button"
                    className="profile-menu-trigger"
                    aria-expanded={profileSection === 'about'}
                    onClick={() => setProfileSection(profileSection === 'about' ? null : 'about')}
                  >
                    <Info size={19} />
                    <div className="profile-menu-text">
                      <strong>Thông tin ứng dụng</strong>
                      <small>SMART sEMG TRAINER v1.2.0 · 1 kênh CH1 & bảo mật AEAD</small>
                    </div>
                    <ChevronRight size={17} className={profileSection === 'about' ? 'rotated' : ''} />
                  </button>
                  {profileSection === 'about' && (
                    <div className="profile-menu-content">
                      <p className="microcopy">
                        Ứng dụng hỗ trợ theo dõi tín hiệu điện cơ bề mặt (sEMG) 1 kênh (CH1) qua chuỗi dữ liệu RAW, tín hiệu lọc số và biên độ RMS/envelope để luyện tập phản hồi sinh học trực quan. Thiết bị chỉ phục vụ luyện tập, không thay thế chẩn đoán y khoa.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {showDevTools && (
                <details className="developer-panel" open={dev} onToggle={e => setDev(e.currentTarget.open)}>
                  <summary>Khu vực phát triển & kiểm thử</summary>
                  <LatencyPanel view={view} controller={controller} />
                  <p>Các lỗi mô phỏng dưới đây chỉ áp dụng với bản thử.</p>
                  <div className="button-row">
                    <button
                      className="button outline"
                      disabled={controller.adapter !== mock || !connected}
                      onClick={() => mock.loseConnection()}
                    >
                      <WifiOff size={16} />Mô phỏng mất kết nối
                    </button>
                    <button
                      className="button outline"
                      disabled={controller.adapter !== mock || connected}
                      onClick={() => void connectMock()}
                    >
                      <Wifi size={16} />Kết nối lại mô phỏng
                    </button>
                  </div>
                  <label className="toggle-row">
                    <span>
                      <strong>Lệnh chậm (3 giây)</strong>
                      <small>Kiểm tra khóa nút và ưu tiên Dừng.</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={faultDelay}
                      onChange={e => {
                        setFaultDelay(e.target.checked);
                        mock.delay = e.target.checked ? 3000 : 160;
                      }}
                    />
                  </label>
                  <div className="button-row">
                    <button
                      className="button subtle"
                      onClick={() => {
                        mock.dropNextAck = true;
                        setNotice('Lệnh kế tiếp sẽ thiếu phản hồi ACK.');
                      }}
                    >
                      Bỏ xác nhận lệnh kế tiếp
                    </button>
                    <button
                      className="button subtle"
                      onClick={() => {
                        mock.rejectNextCommand = true;
                        setNotice('Lệnh kế tiếp sẽ bị từ chối để kiểm tra khôi phục kênh.');
                      }}
                    >
                      Từ chối lệnh kế tiếp
                    </button>
                  </div>
                </details>
              )}
            </section>
          )}

          <footer className="page-footer">
            <span><Leaf size={13} />SMART sEMG TRAINER · Đo sEMG 1 kênh (CH1)</span>
            <span>Không dùng cho mục đích chẩn đoán y khoa</span>
          </footer>
        </main>
      </div>

      {/* Bottom Navigation */}
      <nav className="bottom-nav" aria-label="Điều hướng trên điện thoại">
        {nav.map(n => (
          <button
            key={n.id}
            type="button"
            aria-current={tab === n.id ? 'page' : undefined}
            className={tab === n.id ? 'active' : ''}
            onClick={() => {
              setTab(n.id);
              setSelected(null);
            }}
          >
            <n.icon size={20} />
            <span>{n.label}</span>
          </button>
        ))}
      </nav>

      {/* Active session dock when viewing non-training tabs */}
      {active && (!mobile || tab !== 'train') && (
        <div className="active-session-dock">
          <span className="dock-state">
            <Activity size={17} />
            <span>
              <strong>
                {connected
                  ? audio.countdown !== null
                    ? 'Đang chuẩn bị'
                    : f?.state === 'calibrating'
                      ? 'Đang hiệu chuẩn'
                      : f?.paused
                        ? 'Đang tạm dừng'
                        : free
                          ? 'Đang đếm tự do'
                          : 'Đang tập luyện'
                  : 'Chưa xác nhận trạng thái'}
              </strong>
              <small>
                {channelText(activeChannel, activeMuscle)} · {free ? `${valid} lần co` : `${valid} / ${goal} lượt đạt`}
              </small>
            </span>
          </span>
          {!connected && (
            <button className="text-button" onClick={() => void controller.connect().catch(() => {})}>
              Kết nối lại
            </button>
          )}
          <button
            className="button danger"
            disabled={!connected || view.pending === 'stop'}
            onClick={stop}
          >
            {view.pending === 'stop' ? <LoaderCircle className="spin" size={16} /> : <Square size={13} fill="currentColor" />}
            {view.pending === 'stop' ? 'Đang gửi…' : 'Kết thúc'}
          </button>
        </div>
      )}

      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          <span>{notice}</span>
          <button onClick={() => setNotice('')} aria-label="Đóng thông báo">×</button>
        </div>
      )}

      {/* Welcome Modal */}
      {welcome && (
        <Modal
          title="Chào mừng đến với sEMG Trainer"
          onClose={() => {
            safeSet('semg-onboarded', 'true');
            setWelcome(false);
          }}
        >
          <div className="welcome-mascot">
            <MuscleIllustration muscle={activeMuscle} />
          </div>
          <div className="welcome-copy">
            <span className="eyebrow">BẮT ĐẦU TỪ MỘT NHỊP NHỎ</span>
            <h2>Theo dõi hoạt động cơ kênh CH1.</h2>
            <p>
              Tập theo mục tiêu hoặc đếm tự do liên tục trên <strong>1 kênh đo CH1</strong>; vùng cơ ({muscleLabel(activeMuscle).toLowerCase()}) là thông tin vị trí đặt điện cực của phiên.
            </p>
          </div>
          <button className="button primary full-width" onClick={() => void finishWelcome('mock')}>
            <FlaskConical size={18} />Dùng thử nguồn mô phỏng<ArrowRight size={17} />
          </button>
          <button className="button outline full-width" onClick={() => void finishWelcome('device')}>
            <Smartphone size={18} />Kết nối thiết bị thật
          </button>
        </Modal>
      )}

      {/* Shared Help & Electrode Guide Modal (Single-channel CH1) */}
      {help && (
        <Modal
          title="Hướng dẫn điện cực & luyện tập"
          variant={mobile ? 'sheet' : 'modal'}
          onClose={() => setHelp(false)}
        >
          <div className="help-arm-preview">
            <MuscleIllustration muscle={activeMuscle} state="training" phase="contract" />
          </div>
          <div className="alert neutral">
            <Info size={18} />
            <span>
              Kênh đo: <strong>CH1</strong> · Vị trí đặt điện cực hiện tại: <strong>{muscleLabel(activeMuscle)}</strong>. Tín hiệu <strong>RAW</strong>, <strong>tín hiệu lọc số</strong> và <strong>RMS/envelope</strong> là các dạng dữ liệu tuần tự của cùng một kênh CH1.
            </span>
          </div>
          <ol className="help-steps">
            <li>
              <strong>Gắn điện cực cho kênh CH1 (với thiết bị thật)</strong>
              <p>
                Làm sạch vùng da trước khi dán. Dán cặp điện cực đo <strong>CH1</strong> dọc theo thân cơ <strong>{muscleLabel(activeMuscle).toLowerCase()}</strong> và điện cực tham chiếu ở vùng xương cổ tay/khuỷu tay. Nếu dùng <strong>Mô phỏng</strong> hoặc <strong>Phát lại</strong>, bạn không cần gắn điện cực.
              </p>
            </li>
            <li>
              <strong>Thả lỏng để hiệu chuẩn mức nghỉ</strong>
              <p>Đặt tay trên mặt phẳng thoải mái trong vài giây để thiết bị tự động lấy mốc nghỉ trước khi bắt đầu.</p>
            </li>
            <li>
              <strong>Nhịp Co – Giữ – Thả chuẩn xác</strong>
              <p>
                Một chu kỳ <strong>Co → Giữ → Thả</strong> chỉ được tính sau khi thả lỏng cơ. Ở chế độ <strong>Luyện tập</strong>, cần giữ đủ thời gian mục tiêu để tính là <strong>Lượt đạt</strong> (các lần thả sớm vẫn được ghi nhận vào Tổng lần thử).
              </p>
            </li>
            <li>
              <strong>Xem lại & xuất dữ liệu tại Lịch sử</strong>
              <p>Mỗi buổi tập lưu kèm kênh và vị trí cơ tại thời điểm tập. Mở mục <strong>Lịch sử</strong> và nhấn <strong>Xuất dữ liệu</strong> để tải Báo cáo buổi tập (PDF/Excel) hoặc Dữ liệu nghiên cứu — RAW (ZIP).</p>
            </li>
          </ol>
          <button className="button primary full-width" onClick={() => setHelp(false)}>
            <Check size={17} />Đã hiểu
          </button>
        </Modal>
      )}

      {/* Audio Modal */}
      {audioOpen && (
        <Modal
          title="Âm báo & giọng hướng dẫn"
          variant={mobile ? 'sheet' : 'modal'}
          onClose={() => setAudioOpen(false)}
        >
          <AudioControls
            preferences={audio.preferences}
            onChange={audio.change}
            onTest={audio.test}
            message={audio.message}
          />
          <button className="button primary full-width" onClick={() => setAudioOpen(false)}>
            <Check size={16} />Xong
          </button>
        </Modal>
      )}

      {/* Install PWA Modal */}
      {install && (
        <Modal
          title="Thêm vào màn hình chính"
          variant={mobile ? 'sheet' : 'modal'}
          onClose={() => setInstall(false)}
        >
          <h3>Trên iPhone / Safari</h3>
          <ol className="install-steps">
            <li>Mở ứng dụng trong Safari.</li>
            <li>Nhấn biểu tượng <strong>Chia sẻ</strong>, chọn <strong>Thêm vào MH chính</strong>.</li>
          </ol>
          <h3>Trên Android / Chrome</h3>
          <p>Mở menu ⋮, chọn <strong>Cài đặt ứng dụng</strong> hoặc <strong>Thêm vào màn hình chính</strong>.</p>
          <button className="button primary full-width" onClick={() => setInstall(false)}>
            <Check size={17} />Đã hiểu
          </button>
        </Modal>
      )}

      {/* Export Modal */}
      {exportModalTarget && (
        <ExportModal
          record={exportModalTarget.record}
          sessions={exportModalTarget.sessions}
          repository={repository}
          mobile={mobile}
          onClose={() => setExportModalTarget(null)}
        />
      )}

      {/* Delete Session Confirmation */}
      {deleteId && (
        <Modal title="Xóa buổi tập này?" onClose={() => setDeleteId(null)}>
          <p>Buổi tập sẽ bị xóa khỏi lịch sử trên thiết bị này.</p>
          <div className="button-row">
            <button className="button subtle" onClick={() => setDeleteId(null)}>Giữ lại</button>
            <button className="button danger" onClick={() => void remove()}>
              <Trash2 size={16} />Xóa buổi tập
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

const REP_PAGE_SIZE = 5;

function SessionDetail({
  record: r,
  onBack,
  onExport,
  onDelete,
}: {
  record: SessionRecord;
  onBack: () => void;
  onExport: (record: SessionRecord) => void;
  onDelete: () => void;
}) {
  const f = r.snapshot;
  const free = isFreeMode(f.settings);
  const [focusRange, setFocusRange] = useState<TimeWindow | null>(null);
  const [repPage, setRepPage] = useState(1);

  useEffect(() => {
    setRepPage(1);
    setFocusRange(null);
  }, [r.id]);

  // Historical record preserves its own channel and muscle at the time of training
  const recordedChannel = f.selected_channel;
  const recordedMuscle = f.settings.muscle;

  const totalReps = f.repetitions.length;
  const totalRepPages = Math.max(1, Math.ceil(totalReps / REP_PAGE_SIZE));
  const currentRepPage = Math.min(repPage, totalRepPages);
  const repStartIndex = (currentRepPage - 1) * REP_PAGE_SIZE;
  const pagedRepetitions = f.repetitions.slice(repStartIndex, repStartIndex + REP_PAGE_SIZE);

  return (
    <div className="session-detail">
      <button type="button" className="text-button back-button" onClick={onBack}>
        <ChevronLeft size={16} />Quay lại danh sách Lịch sử
      </button>
      <section className="card result-card">
        <div className="card-heading">
          <div>
            <span className="eyebrow">{free ? 'CHI TIẾT PHIÊN ĐẾM TỰ DO' : 'CHI TIẾT BUỔI TẬP'}</span>
            <h2>
              {free
                ? 'Kết quả phiên đếm tự do'
                : f.state === 'completed'
                  ? 'Hoàn thành mục tiêu'
                  : 'Kết quả buổi tập đã lưu'}
            </h2>
            <p>
              {localDate(f.started_at)}
              {f.started_at_estimated ? ' (giờ ước lượng)' : ''} · {modeLabel(f.settings.mode)} ·{' '}
              <strong>{channelText(recordedChannel, recordedMuscle)}</strong>
            </p>
          </div>
          <span className="result-trophy">{free ? <Gauge size={26} /> : <Trophy size={26} />}</span>
        </div>

        {free ? (
          <div className="result-metrics">
            <div>
              <strong>{f.valid_count}<small> lần</small></strong>
              <span>Số lần co cơ</span>
            </div>
            <div>
              <strong>{duration(f.duration_ms)}</strong>
              <span>Thời gian đo</span>
            </div>
            <div>
              <strong>{channelText(recordedChannel, recordedMuscle)}</strong>
              <span>Kênh & vị trí cơ</span>
            </div>
          </div>
        ) : (
          <div className="result-metrics">
            <div>
              <strong>{f.valid_count}<small> / {f.settings.target}</small></strong>
              <span>Lượt đạt mục tiêu</span>
            </div>
            <div>
              <strong>{f.total_count}</strong>
              <span>Tổng lần thử</span>
            </div>
            <div>
              <strong>{duration(f.duration_ms)}</strong>
              <span>Thời gian ({channelText(recordedChannel, recordedMuscle)})</span>
            </div>
          </div>
        )}

        <div className="result-footer">
          <div className="inline-badges">
            <span className={`badge ${free ? 'mode-free' : 'neutral'}`}>{modeLabel(f.settings.mode)}</span>
            <span className="badge simulation">
              {f.source === 'simulation' ? 'Dữ liệu mô phỏng' : f.source === 'replay' ? 'Dữ liệu phát lại' : 'Thiết bị thật'}
            </span>
            <SaveBadge status={r.sync} />
          </div>
          <span className="badge neutral">
            {free && f.state === 'stopped' ? 'Đã kết thúc' : stateLabels[f.state]}
          </span>
        </div>

        {r.gaps > 0 && (
          <div className="alert neutral">
            <Info size={17} />
            <span>Có {r.gaps} khoảng thiếu mẫu RMS trên đường truyền. Kết quả lượt được đối chiếu từ sổ thiết bị.</span>
          </div>
        )}
      </section>

      <SignalChart samples={r.samples} frame={f} history focusRange={focusRange} />

      <section className="card repetitions-card">
        <div className="card-heading">
          <h2>{free ? 'Danh sách các lần co cơ' : 'Chi tiết từng lần thử'}</h2>
          <span className="muted">
            {free
              ? 'Một chu kỳ co → thả tính 1 lần'
              : `Mục tiêu giữ tối thiểu ${(f.settings.min_hold_ms / 1000).toLocaleString('vi-VN')} giây`}
          </span>
        </div>
        {f.repetitions.length ? (
          <>
            <p className="review-hint">Chạm vào một dòng để phóng to đoạn tín hiệu tương ứng trên biểu đồ.</p>
            <div className="rep-table rep-table-extended">
              <div className="rep-table-head">
                <span>{free ? 'Lần' : 'Lần thử'}</span>
                <span>{free ? 'Thời gian co' : 'Thời gian giữ'}</span>
                <span>Nghỉ trước đó</span>
                <span>Trong vùng</span>
                <span>Kết quả</span>
              </div>
              {pagedRepetitions.map(rep => (
                <button
                  type="button"
                  className="rep-table-row"
                  key={rep.id}
                  onClick={e => {
                    setFocusRange({
                      start: Math.max(0, (rep.ended_ms - rep.hold_ms - 500) / 1000),
                      end: (rep.ended_ms + 700) / 1000,
                    });
                    e.currentTarget
                      .closest('.session-detail')
                      ?.querySelector('.signal-card')
                      ?.scrollIntoView({
                        behavior:
                          window.matchMedia('(prefers-reduced-motion: reduce)').matches || reducedMotionPreference()
                            ? 'auto'
                            : 'smooth',
                        block: 'center',
                      });
                  }}
                >
                  <strong>#{String(rep.ordinal).padStart(2, '0')}</strong>
                  <span>{(rep.hold_ms / 1000).toFixed(1)} giây</span>
                  <span>{rep.rest_ms == null ? '0.0 giây' : `${(rep.rest_ms / 1000).toFixed(1)} giây`}</span>
                  <span>{rep.in_zone_ms == null ? '0.0 giây' : `${(rep.in_zone_ms / 1000).toFixed(1)} giây`}</span>
                  <span className={`rep-result ${free || rep.valid ? 'valid' : 'invalid'}`}>
                    {free || rep.valid ? <CheckCircle2 size={15} /> : <Clock3 size={15} />}{' '}
                    {free ? 'Đã ghi nhận' : rep.valid ? 'Đạt mục tiêu' : f.settings.zone_enabled ? 'Chưa đủ trong vùng' : 'Giữ chưa đủ'}
                  </span>
                </button>
              ))}
            </div>
            {totalReps > REP_PAGE_SIZE && (
              <nav className="rep-pagination" aria-label="Phân trang chi tiết từng lần thử">
                <button
                  type="button"
                  className="rep-page-btn nav-arrow"
                  disabled={currentRepPage <= 1}
                  onClick={() => setRepPage(p => Math.max(1, p - 1))}
                  aria-label="Trang trước"
                >
                  <ChevronLeft size={16} />
                </button>
                {Array.from({ length: totalRepPages }, (_, idx) => {
                  const pageNum = idx + 1;
                  const isCurrent = pageNum === currentRepPage;
                  return (
                    <button
                      key={pageNum}
                      type="button"
                      className={`rep-page-btn ${isCurrent ? 'active' : ''}`}
                      aria-current={isCurrent ? 'page' : undefined}
                      onClick={() => setRepPage(pageNum)}
                    >
                      {pageNum}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="rep-page-btn nav-arrow"
                  disabled={currentRepPage >= totalRepPages}
                  onClick={() => setRepPage(p => Math.min(totalRepPages, p + 1))}
                  aria-label="Trang sau"
                >
                  <ChevronRight size={16} />
                </button>
              </nav>
            )}
          </>
        ) : (
          <p className="muted">Chưa có chu kỳ co–thả nào được ghi nhận trong buổi này.</p>
        )}
      </section>

      <div className="detail-actions">
        <button type="button" className="button primary" onClick={() => onExport(r)}>
          <ArrowDownToLine size={16} />Xuất dữ liệu
        </button>
        <button type="button" className="button text-danger" onClick={onDelete}>
          <Trash2 size={16} />Xóa buổi tập
        </button>
      </div>
    </div>
  );
}
