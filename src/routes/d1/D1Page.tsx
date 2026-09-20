import { useState, useEffect, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import rawManifest from '../../../public/d1/manifest.json';

type AppState = 'idle' | 'spread' | 'gallery';

const SLIDE_MS = 7000;  // 4s still + 3s crossfade
const FADE_MS = 3000;
const IDLE_TIMEOUT = 60; // seconds
const IDLE_TIMEOUT_MS = IDLE_TIMEOUT * 1000;

// 明信片比例（宽:高 ≈ 3:2）
const PC = 1.5;
const CCARD_W = 210, CCARD_H = CCARD_W / PC; // 坐标卡尺寸
const TCARD_W = 174, TCARD_H = TCARD_W / PC;  // 类型卡尺寸

interface Cat { key: string; title: string; subtitle: string; icon: string; desc: string; }
const CATS: Cat[] = [
  { key: 'star', title: '追随一颗星', subtitle: 'Follow a Star', icon: '✦', desc: '星空轨迹、行星、银河' },
  { key: 'sky', title: '回到某一年的天空', subtitle: 'Return to That Sky', icon: '☀', desc: '日出日落、时间切片' },
  { key: 'shenshan', title: '定位深汕天空', subtitle: 'Locate Shenshan Sky', icon: '◈', desc: '从深汕天文台仰望星座' },
  { key: 'random', title: '交给随机宇宙', subtitle: 'Surrender to the Cosmos', icon: '◎', desc: '星云、星系、彗星' },
];

// 构建初始图片列表（使用相对路径，双击打开或任何静态托管均可直接访问）
const buildInitialImages = (): string[][] => {
  const m = rawManifest as Record<string, string[]>;
  return CATS.map(c => (m[c.key] ?? []).map((f: string) => `./d1/${c.key}/${f}`));
};

// 预设星座顺序（黄道十二星座），未匹配到星表时按此循环标注
const ZODIAC = ['白羊座', '金牛座', '双子座', '巨蟹座', '狮子座', '处女座', '天秤座', '天蝎座', '射手座', '摩羯座', '水瓶座', '双鱼座'];

// 星图预设置表：name 为文件名（去掉 star_ 前缀与扩展名），label 为展示标注，数组顺序即星座展示顺序
const STAR_CATALOG: { name: string; label: string }[] = [
  { name: '猎户座和火星（左上）', label: '猎户座' },
  { name: '狮子座', label: '狮子座' },
  { name: '天蝎座', label: '天蝎座' },
  { name: '天琴座、天鹰座、天鹅座', label: '天琴座·天鹰座·天鹅座' },
  { name: '天鹅座、天琴座', label: '天鹅座·天琴座' },
  { name: '夏季大三角', label: '夏季大三角' },
  { name: '半人马座、豺狼座和南十字座', label: '半人马座·豺狼座·南十字座' },
  { name: '南十字座', label: '南十字座' },
  { name: '乌鸦座', label: '乌鸦座' },
  { name: '天兔座', label: '天兔座' },
  { name: '海豚座', label: '海豚座' },
  { name: '衣架星群', label: '衣架星群' },
];

/** 从图片文件名解析日期年份与名称，如 star_20180913星轨.jpg → { year: 2018, name: '星轨' } */
function parseD1File(file: string): { year?: number; name: string } {
  const base = file.split('/').pop() ?? file;
  const noExt = base.replace(/\.[^.]+$/, '');
  const m = noExt.match(/(\d{8})(.*)$/);
  if (m) return { year: parseInt(m[1].slice(0, 4), 10), name: m[2] };
  return { year: undefined, name: noExt.replace(/^[a-z]+_/, '') };
}

// 唯一观测者序号存储 key
const SEQ_STORAGE_KEY = 'SHENSHAN_D1_OBSERVER_SEQ';
// 扫码服务默认线上公网地址（已上线的 GitHub Pages 专属地址，手机 4G/5G 随时随地可直接扫码）
const DEFAULT_ONLINE_URL = 'https://alkene-dt.github.io/Alkene_shenshan-D1-sky/';

/** 规范化扫码服务地址：自动纠正 github.com 仓库源码地址为真正的 github.io 网站地址 */
function normalizeServerUrl(raw: string): string {
  let u = (raw || '').trim();
  if (!u) return DEFAULT_ONLINE_URL;
  // 自动将用户误填的 github.com 仓库地址转换为真正的 github.io 网站地址
  if (u.includes('github.com/')) {
    u = u.replace(/https?:\/\/github\.com\/([^\/]+)\/([^\/\?#]+).*/i, 'https://$1.github.io/$2/');
  }
  if (u.startsWith('http://') || u.startsWith('https://')) {
    return u.endsWith('/') ? u : `${u}/`;
  }
  return `http://${u}/`;
}

let _inMemorySeq = 1;

/** 获取当前待分配的观测者序号（只读，不递增。初始默认 001） */
function getCurrentObserverNo(): string {
  try {
    const raw = localStorage.getItem(SEQ_STORAGE_KEY);
    let val = raw !== null ? parseInt(raw, 10) : 1;
    if (isNaN(val) || val < 1) val = 1;
    return String(val).padStart(3, '0');
  } catch {
    return String(_inMemorySeq || 1).padStart(3, '0');
  }
}

/** 消费并递增持久化的观测者序号（仅在确认下载或扫码完成后调用，返回递增后的新序号） */
function commitAndAdvanceObserverNo(): string {
  try {
    const raw = localStorage.getItem(SEQ_STORAGE_KEY);
    let val = raw !== null ? parseInt(raw, 10) : 1;
    if (isNaN(val) || val < 1) val = 1;
    val += 1;
    localStorage.setItem(SEQ_STORAGE_KEY, String(val));
    return String(val).padStart(3, '0');
  } catch {
    _inMemorySeq = (_inMemorySeq || 1) + 1;
    return String(_inMemorySeq).padStart(3, '0');
  }
}

/** 生成 1200x800 高清宇宙坐标卡明信片图片 */
async function generatePostcardCanvas(imgSrc: string, oid: string, date: string, no: string, title: string): Promise<string> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 800;
    const ctx = canvas.getContext('2d');
    if (!ctx) return resolve('');

    const loadImage = (src: string): Promise<HTMLImageElement> => {
      return new Promise((res, rej) => {
        const img = new Image();
        if (!window.location.protocol.startsWith('file:')) {
          img.crossOrigin = 'anonymous';
        }
        img.onload = () => res(img);
        img.onerror = () => rej();
        img.src = src;
      });
    };

    (async () => {
      let img: HTMLImageElement | null = null;
      try {
        img = await loadImage(imgSrc);
      } catch {
        const alt = imgSrc.includes('/public/d1/')
          ? imgSrc.replace('/public/d1/', '/d1/')
          : (imgSrc.includes('/d1/') ? imgSrc.replace('/d1/', '/public/d1/') : imgSrc);
        try {
          img = await loadImage(alt);
        } catch {
          img = null;
        }
      }

      // 1. 深邃星空底色
      ctx.fillStyle = '#080a14';
      ctx.fillRect(0, 0, 1200, 800);

      // 2. 居中 cover 绘制星象主图（上方 1200 x 550）
      if (img) {
        const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
        const targetW = 1200, targetH = 550;
        const scale = Math.max(targetW / iw, targetH / ih);
        const sw = targetW / scale, sh = targetH / scale;
        const sx = (iw - sw) / 2, sy = (ih - sh) / 2;
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);

        // 3. 渐变过渡遮罩
        const grad = ctx.createLinearGradient(0, 440, 0, 550);
        grad.addColorStop(0, 'rgba(8,10,20,0)');
        grad.addColorStop(1, '#080a14');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 440, 1200, 110);
      }

      // 4. 尊贵金色双边框
      ctx.strokeStyle = 'rgba(201,169,110,0.55)';
      ctx.lineWidth = 2;
      ctx.strokeRect(30, 30, 1140, 740);

      ctx.strokeStyle = 'rgba(201,169,110,0.22)';
      ctx.lineWidth = 1;
      ctx.strokeRect(38, 38, 1124, 724);

      // 5. 气象天体编号与日期
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = '22px "Microsoft YaHei", sans-serif';
      ctx.fillText(`${oid} / 气象编号 / ${date}`, 60, 615);

      // 6. 唯一观测者序号高亮
      ctx.fillStyle = '#f4f7ff';
      ctx.font = 'bold 36px "Microsoft YaHei", sans-serif';
      ctx.fillText(`你是 深汕气象天文馆 第 ${no} 号观测者`, 60, 675);

      // 7. 馆名与展项标识
      ctx.fillStyle = '#c9a96e';
      ctx.font = '24px "Microsoft YaHei", sans-serif';
      ctx.fillText(`✦ 深汕气象天文科普馆 · ${title}`, 60, 728);

      try {
        resolve(canvas.toDataURL('image/jpeg', 0.95));
      } catch {
        resolve('');
      }
    })();
  });
}

/** 移动端专属扫码下载视图（游客手机扫码直接呈现下载页） */
function MobilePostcardDownloadView() {
  const params = new URLSearchParams(window.location.search);
  const card = params.get('card') || 'star';
  const rawImg = params.get('img') || '';
  const no = params.get('no') || '001';
  const oid = params.get('oid') || 'NGC-7824';
  const date = params.get('date') || '2026.09.18';

  const cat = CATS.find(c => c.key === card) || CATS[0];
  const imgSrc = rawImg || './d1/star/star_半人马座、豺狼座和南十字座.JPG';

  const [downloading, setDownloading] = useState(false);
  const [compositeUrl, setCompositeUrl] = useState('');

  // 页面加载时自动预合成 Canvas 高清卡片
  useEffect(() => {
    (async () => {
      const url = await generatePostcardCanvas(imgSrc, oid, date, no, cat.title);
      if (url) setCompositeUrl(url);
    })();
  }, [imgSrc, oid, date, no, cat.title]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const dataUrl = compositeUrl || await generatePostcardCanvas(imgSrc, oid, date, no, cat.title);
      if (dataUrl) {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `深汕气象天文馆_第${no}号观测者宇宙坐标卡_${date}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div style={{
      width: '100vw', minHeight: '100vh', background: 'radial-gradient(ellipse at 50% 15%, #181d3d 0%, #060812 75%)',
      color: '#fff', fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
      display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 16px 40px', boxSizing: 'border-box'
    }}>
      <div style={{ textAlign: 'center', marginBottom: '16px' }}>
        <div style={{ fontSize: '13px', color: '#c9a96e', letterSpacing: '0.12em', fontWeight: 600 }}>✦ 深汕气象天文科普馆</div>
        <h1 style={{ fontSize: '20px', fontWeight: 400, letterSpacing: '0.08em', margin: '4px 0 0' }}>宇宙坐标卡 · 专属纪念</h1>
      </div>

      <div style={{
        width: '100%', maxWidth: '440px', borderRadius: '16px', overflow: 'hidden',
        background: 'rgba(10,12,24,0.92)', border: '1px solid rgba(201,169,110,0.3)',
        boxShadow: '0 18px 45px rgba(0,0,0,0.7), 0 0 35px rgba(140,100,255,0.15)',
        marginBottom: '20px'
      }}>
        <div style={{ width: '100%', aspectRatio: '3/2', overflow: 'hidden', background: '#000' }}>
          <img
            src={compositeUrl || imgSrc}
            alt="宇宙坐标卡"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        </div>
        {!compositeUrl && (
          <div style={{ padding: '14px 18px' }}>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.45)', letterSpacing: '0.08em' }}>{oid} / 气象编号 / {date}</div>
            <div style={{ fontSize: '16px', color: '#f4f7ff', fontWeight: 600, marginTop: '4px' }}>
              你是 深汕气象天文馆 第<span style={{ color: '#ffd76a' }}>{no}</span>号观测者
            </div>
            <div style={{ fontSize: '13px', color: '#c9a96e', marginTop: '6px' }}>{cat.icon} {cat.title}</div>
          </div>
        )}
      </div>

      <div style={{ width: '100%', maxWidth: '440px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
        <button
          onClick={handleDownload}
          disabled={downloading}
          style={{
            width: '100%', padding: '14px', borderRadius: '12px', border: 'none',
            background: 'linear-gradient(135deg, #c9a96e, #e8c36a)',
            color: '#0d1020', fontSize: '16px', fontWeight: 600, letterSpacing: '0.06em',
            cursor: 'pointer', boxShadow: '0 8px 24px rgba(201,169,110,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
          }}
        >
          <span>⤓</span> {downloading ? '正在生成高清卡片...' : '保存 / 下载宇宙坐标卡'}
        </button>
        <p style={{ margin: 0, fontSize: '12px', color: 'rgba(255,255,255,0.5)', textAlign: 'center', letterSpacing: '0.04em' }}>
          提示：点击上方按钮直接下载，长按卡片亦可保存到相册
        </p>
      </div>
    </div>
  );
}

export default function D1Page() {
  // 检查是否为手机扫码进入的专属下载页
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const isMobileDownload = searchParams && (searchParams.has('card') || searchParams.has('img') || searchParams.has('download'));
  if (isMobileDownload) {
    return <MobilePostcardDownloadView />;
  }

  const [state, setState] = useState<AppState>('idle');
  const [images, setImages] = useState<string[][]>(() => buildInitialImages());
  const [imgIdx, setImgIdx] = useState(0);
  const [showA, setShowA] = useState(true);
  const [selCat, setSelCat] = useState<Cat | null>(null);
  const [selImg, setSelImg] = useState('');
  const [postcard, setPostcard] = useState<{ oid: string; date: string; no: string; catLabel: string } | null>(null);
  const [qrUrl, setQrUrl] = useState('');
  const [serverHost, setServerHost] = useState<string>(() => {
    if (typeof window === 'undefined') return DEFAULT_ONLINE_URL;
    const stored = localStorage.getItem('SHENSHAN_SERVER_HOST');
    if (stored) return normalizeServerUrl(stored);
    if (window.location.protocol.startsWith('http') && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      return window.location.origin + window.location.pathname;
    }
    return DEFAULT_ONLINE_URL;
  });
  const [showText, setShowText] = useState(false);
  const [spreadIn, setSpreadIn] = useState(false); // 4 张类型卡依次铺开
  const [galleryIn, setGalleryIn] = useState(false); // 图片弧形铺开
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null); // 抽牌选中的下标
  const [scrollOffset, setScrollOffset] = useState(2.5); // 弧形卡牌滑动偏移量
  const [fanSize, setFanSize] = useState({ w: 900, h: 420 });
  const [downloadSuccessTip, setDownloadSuccessTip] = useState('');
  const idleTimer = useRef<ReturnType<typeof setTimeout>>();
  const fanRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef({
    isDragging: false,
    startX: 0,
    startOffset: 2.5,
    hasMoved: false,
  });

  // 图片加载失败时自动尝试备用路径（例如从 ./d1/ 回退到 ./public/d1/，反之亦然）
  const handleImgError = useCallback((e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    const el = e.currentTarget;
    const cur = el.src;
    if (el.dataset.fallback) return;
    el.dataset.fallback = '1';
    if (cur.includes('/public/d1/')) {
      el.src = cur.replace('/public/d1/', '/d1/');
    } else if (cur.includes('/d1/')) {
      el.src = cur.replace('/d1/', '/public/d1/');
    }
  }, []);

  // 内置清单已在组件初始化时自动就绪，本地与服务器均可直接秒开，无需运行时网络请求

  const screensaverOn = state === 'idle' || state === 'spread';

  // Auto-cycle（屏保可见时持续轮播）
  useEffect(() => {
    if (!screensaverOn) return;
    const flat = images.flat();
    if (flat.length < 2) return;
    const t = setInterval(() => {
      setShowA(s => !s);
      setImgIdx(i => (i + 1) % flat.length);
    }, SLIDE_MS);
    return () => clearInterval(t);
  }, [screensaverOn, images]);

  // Idle timer: 60s 无操作返回屏保
  const resetIdle = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      setState('idle');
      setSelectedIdx(null);
      setPostcard(null);
      setSelImg('');
      setQrUrl('');
      setSpreadIn(false);
      setGalleryIn(false);
    }, IDLE_TIMEOUT_MS);
  }, []);

  useEffect(() => {
    const onAct = () => resetIdle();
    window.addEventListener('pointerdown', onAct);
    window.addEventListener('keydown', onAct);
    resetIdle();
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      window.removeEventListener('pointerdown', onAct);
      window.removeEventListener('keydown', onAct);
    };
  }, [resetIdle]);

  // 状态进出动效
  useEffect(() => {
    if (state === 'spread') {
      const t = setTimeout(() => setSpreadIn(true), 40);
      return () => clearTimeout(t);
    } else {
      setSpreadIn(false);
    }
  }, [state]);

  useEffect(() => {
    if (state === 'gallery') {
      const t = setTimeout(() => setGalleryIn(true), 40);
      const catIdx = selCat ? CATS.indexOf(selCat) : -1;
      const count = catIdx >= 0 ? (images[catIdx] ?? []).length : 0;
      const initOffset = count <= 6 ? Math.max(0, (count - 1) / 2) : 2.5;
      setScrollOffset(initOffset);
      return () => clearTimeout(t);
    } else {
      setGalleryIn(false);
    }
  }, [state, selCat, images]);

  // 测量扇形容器真实尺寸
  useEffect(() => {
    if (state !== 'gallery') return;
    const el = fanRef.current; if (!el) return;
    const measure = () => setFanSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [state]);

  // 大屏抽卡 → 提取当前观测者序号（只读不递增） + 生成坐标卡数据 + 生成带参二维码
  const pickImage = useCallback(async (img: string, overrideNo?: string) => {
    if (!selCat) return;
    setSelImg(img);
    const catIdx = CATS.indexOf(selCat);
    const flat = images[catIdx] ?? [];
    const idx = flat.indexOf(img);
    const now = new Date();
    const oids = ['NGC-7824','M42','M31','M16','M51','C2023','IC-434','NGC-6960'];
    const oid = oids[idx % oids.length] ?? 'NGC-7824';
    const date = `${now.getFullYear()}.${String(now.getMonth()+1).padStart(2,'0')}.${String(now.getDate()).padStart(2,'0')}`;

    // 点击/切换卡牌时不自增序号，只读取当前有效序号（只有下载或确认后才自增）
    const observerNo = overrideNo || getCurrentObserverNo();
    setPostcard({ oid, date, no: observerNo, catLabel: selCat.title });
    setShowText(false);
    setTimeout(() => setShowText(true), 200);

    try {
      const isFileProto = window.location.protocol === 'file:';
      const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const isHttpRemote = window.location.protocol.startsWith('http') && !isLocalHost;

      const hostOrUrl = localStorage.getItem('SHENSHAN_SERVER_HOST') || serverHost || DEFAULT_ONLINE_URL;
      const baseUrl = isHttpRemote
        ? `${location.origin}${location.pathname}`
        : normalizeServerUrl(hostOrUrl);

      // 二维码携带完整天体编号、图片路径与观测者序号，扫码直达专属下载界面（兼容 4G/5G 公网及局域网）
      const u = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}card=${selCat.key}&img=${encodeURIComponent(img)}&no=${observerNo}&oid=${oid}&date=${date}`;
      const d = await QRCode.toDataURL(u, {
        width: 280,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#ffffff' }
      });
      setQrUrl(d);
    } catch { setQrUrl(''); }
  }, [selCat, images, serverHost]);

  // 大屏点击一键下载合成明信片（下载成功后触发观测者序号 +1 自增）
  const handleDownloadPostcard = useCallback(async () => {
    if (!postcard || !selCat) return;
    const currentNo = postcard.no;
    const dataUrl = await generatePostcardCanvas(selImg, postcard.oid, postcard.date, currentNo, selCat.title);
    if (dataUrl) {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `深汕气象天文馆_第${currentNo}号观测者宇宙坐标卡_${postcard.date}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // 下载后消费当前序号并推进为下一个序号
      const nextNo = commitAndAdvanceObserverNo();
      setDownloadSuccessTip(`已下载第 ${currentNo} 号！下一位观测者为第 ${nextNo} 号`);
      setTimeout(() => setDownloadSuccessTip(''), 4000);
      pickImage(selImg, nextNo);
    }
  }, [postcard, selCat, selImg, pickImage]);

  // 游客手机扫码完成后确认（推进观测者序号 +1）
  const handleConfirmMobileScan = useCallback(() => {
    if (!postcard) return;
    const currentNo = postcard.no;
    const nextNo = commitAndAdvanceObserverNo();
    setDownloadSuccessTip(`已确认第 ${currentNo} 号！下一位观测者为第 ${nextNo} 号`);
    setTimeout(() => setDownloadSuccessTip(''), 4000);
    pickImage(selImg, nextNo);
  }, [postcard, selImg, pickImage]);

  const flat = images.flat();
  const curA = flat[showA ? imgIdx : (imgIdx + 1) % Math.max(1, flat.length)] ?? '';
  const curB = flat[showA ? (imgIdx + 1) % Math.max(1, flat.length) : imgIdx] ?? '';
  const galFiles = selCat ? (images[CATS.indexOf(selCat)] ?? []) : [];
  const galItems = selCat && selCat.key === 'star'
    ? galFiles.map((f, i) => {
        const { name } = parseD1File(f);
        const idx = STAR_CATALOG.findIndex(c => c.name === name);
        return { file: f, label: idx >= 0 ? STAR_CATALOG[idx].label : ZODIAC[i % ZODIAC.length], sortKey: idx >= 0 ? idx : Number.MAX_SAFE_INTEGER };
      }).sort((a, b) => a.sortKey - b.sortKey)
    : selCat && selCat.key === 'sky'
      ? galFiles.map(f => { const { year } = parseD1File(f); return { file: f, label: year ? `${year} 年` : '', sortKey: year ?? Number.MAX_SAFE_INTEGER }; })
          .sort((a, b) => a.sortKey - b.sortKey)
      : galFiles.map(f => ({ file: f, label: '', sortKey: 0 }));
  const countLabel = selCat?.key === 'star' ? `按星座顺序 · ${galItems.length} 张`
    : selCat?.key === 'sky' ? `按年份顺序 · ${galItems.length} 张`
    : `${galItems.length} 张`;

  const btnGlass: React.CSSProperties = {
    padding: '10px 20px', borderRadius: '12px',
    border: '1px solid rgba(255,255,255,0.2)',
    background: 'rgba(13,18,31,0.7)', backdropFilter: 'blur(14px)',
    color: '#f4f7ff', cursor: 'pointer', fontSize: '0.9rem',
    letterSpacing: '0.06em', fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
  };
  // 明信片卡面通用底色（星夜渐变 + 边框）
  const cardFace: React.CSSProperties = {
    width: '100%', height: '100%', borderRadius: '12px', position: 'relative', overflow: 'hidden',
    border: '1px solid rgba(200,180,255,0.4)',
    background: 'radial-gradient(circle at 30% 20%, rgba(60,44,110,0.9), rgba(12,10,24,0.95) 70%)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '6px',
  };

  // ── 画廊弧形（卡牌超大尺寸 + 扇形互相叠压折叠 + 滑动流转）布局参数 ──
  const n = galItems.length;
  // 卡牌进一步放大：放大至 350px ~ 480px，6张卡牌气势磅礴展开
  const cardW = Math.min(480, Math.max(340, fanSize.w / 3.8));
  const cardH = cardW / PC;

  // 扇形折叠角步长：压缩到约 7.2 度（0.125 rad），产生约 60% 的卡牌自然叠压覆盖
  const spreadR = 0.63;
  const angleStep = spreadR / 5;
  const R = Math.max(fanSize.h * 1.5, fanSize.w * 0.95);
  const cx = fanSize.w / 2;

  // 选牌动效参数
  const selScale = 1.12;
  const outDist = 28;
  // 动态视口高度锚定：保证顶部看板（高约 260px）与下方卡牌最高点之间保留舒适安全距离，彻底杜绝遮挡
  const apexY = Math.max(50, Math.min(fanSize.h * 0.36, fanSize.h - cardH * 1.05));
  const cy = apexY + cardH / 2 + R;

  // 滑动边界限制（保证首尾所有卡牌均可滑入正中）
  const minOffset = n <= 6 ? (n - 1) / 2 : 2.5;
  const maxOffset = n <= 6 ? (n - 1) / 2 : (n - 1) - 2.5;

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', background: '#05070d', overflow: 'hidden', fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif', color: '#fff' }}>
      {/* ═══ 屏保轮播 ═══ */}
      {screensaverOn && (
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
          {flat.length > 0 && (
            <>
              <img src={curA} onError={handleImgError} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: showA ? 1 : 0, transition: `opacity ${FADE_MS}ms ease-in-out` }} />
              <img src={curB} onError={handleImgError} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: showA ? 0 : 1, transition: `opacity ${FADE_MS}ms ease-in-out` }} />
            </>
          )}
          <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.4) 100%)' }} />
        </div>
      )}

      {/* Top bar（独立交付版：已移除「返回主导航」按钮） */}
      {screensaverOn && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, padding: '1.5rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#c9a96e', border: '1px solid rgba(201,169,110,.35)', padding: '6px 10px', borderRadius: '6px' }}>D1</span>
            <strong style={{ fontSize: '20px', fontWeight: 300, letterSpacing: '.1em', marginLeft: '12px' }}>带走一片属于你的天空</strong>
          </div>
        </div>
      )}

      {/* ═══ 左下角 坐标卡（明信片尺寸，铺开时透明度拉低且不消失）═══ */}
      {screensaverOn && (
        <button
          onClick={() => setState(state === 'idle' ? 'spread' : 'idle')}
          style={{
            position: 'absolute', left: '34px', bottom: '34px', zIndex: 15,
            width: CCARD_W, height: CCARD_H, padding: 0, cursor: 'pointer',
            background: 'transparent', border: 'none', borderRadius: '14px',
            opacity: state === 'spread' ? 0.35 : 1,
            transition: 'opacity 0.4s, transform 0.3s',
            boxShadow: '0 12px 36px rgba(0,0,0,0.5), 0 0 40px rgba(140,100,255,0.18)',
          }}
        >
          <div style={cardFace}>
            {/* 少量星光点缀 */}
            {[['18%','24%'],['72%','18%'],['84%','62%'],['30%','70%'],['55%','42%']].map(([l,t], i) => (
              <span key={i} style={{ position: 'absolute', left: l, top: t, width: 3, height: 3, borderRadius: '50%', background: 'rgba(255,255,255,0.8)' }} />
            ))}
            <span style={{ fontSize: '1.2rem', lineHeight: 1, color: '#c9a96e' }}>✦</span>
            <span style={{ fontSize: '0.92rem', fontWeight: 500, letterSpacing: '0.1em', color: '#f4f7ff' }}>定制你的宇宙坐标卡</span>
          </div>
        </button>
      )}

      {/* ═══ 4 张类型卡从左至右依次铺开 ═══ */}
      {state === 'spread' && (
        <div onPointerDown={resetIdle}
          style={{ position: 'absolute', left: 250, right: 0, bottom: 30, zIndex: 16, display: 'flex', gap: 16 }}>
          {CATS.map((c, i) => (
            <button key={c.key} onClick={(e) => { e.stopPropagation(); setSelCat(c); setState('gallery'); }}
              style={{
                width: TCARD_W, height: TCARD_H, padding: 0, cursor: 'pointer',
                background: 'transparent', border: 'none', borderRadius: '12px',
                transform: spreadIn ? 'translateY(0) scale(1)' : 'translateY(46px) scale(0.9)',
                opacity: spreadIn ? 1 : 0,
                transition: `transform 0.5s cubic-bezier(0.22,1,0.36,1) ${i * 100}ms, opacity 0.5s ${i * 100}ms`,
              }}>
              <div style={{ ...cardFace, boxShadow: '0 12px 30px rgba(0,0,0,0.5)', background: 'radial-gradient(circle at 30% 20%, rgba(92,70,165,0.95), rgba(24,18,46,0.96) 70%)' }}>
                <span style={{ fontSize: '1.8rem', lineHeight: 1, color: '#ffd76a', textShadow: '0 0 18px rgba(255,215,106,0.45)' }}>{c.icon}</span>
                <span style={{ fontSize: '0.95rem', fontWeight: 600, letterSpacing: '0.06em', color: '#f7f1d8' }}>{c.title}</span>
                <span style={{ fontSize: '0.62rem', color: 'rgba(247,241,216,0.78)', letterSpacing: '0.04em' }}>{c.subtitle}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* ═══ 画廊页面：明信片尺寸 + 小丑牌弧形铺开 + 抽牌 ═══ */}
      {state === 'gallery' && selCat && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 20, background: 'radial-gradient(ellipse at center, #0d1025 0%, #05070d 75%)', display: 'flex', flexDirection: 'column', padding: '1rem 2rem 0.8rem', boxSizing: 'border-box' }}
          onPointerDown={resetIdle}>
          
          {/* 上方区域：顶栏 + 紧凑型结果展示区（高度自适应，约 120-140px，预留充足净空绝不遮挡卡牌） */}
          <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: '8px', zIndex: 30 }}>
            {/* 顶栏（纯净展示，原右上角返回已移至左下角） */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontSize: '1.25rem', fontWeight: 300, letterSpacing: '0.04em' }}>{selCat.icon} {selCat.title}</span>
                <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)', marginLeft: '12px' }}>{countLabel}</span>
              </div>
            </div>

            {/* 气象观测者坐标卡与大尺寸二维码看板 */}
            {postcard ? (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '28px',
                padding: '12px 24px', borderRadius: '16px',
                background: 'rgba(10, 14, 28, 0.92)', border: '1.5px solid rgba(201, 169, 110, 0.45)',
                boxShadow: '0 16px 45px rgba(0, 0, 0, 0.7), 0 0 30px rgba(201, 169, 110, 0.15)',
                backdropFilter: 'blur(16px)', margin: '0 auto', maxWidth: '960px', width: '100%',
                boxSizing: 'border-box'
              }}>
                {/* 1. 左侧：大尺寸专属宇宙坐标卡 (宽约 350px，高约 210px) */}
                <div style={{
                  width: 'min(350px, 34vw)', borderRadius: '14px', overflow: 'hidden',
                  background: 'rgba(7, 9, 20, 0.95)', border: '1.5px solid rgba(201, 169, 110, 0.45)',
                  boxShadow: '0 12px 32px rgba(0,0,0,0.65)', flexShrink: 0
                }}>
                  <div style={{ width: '100%', height: '135px', overflow: 'hidden', position: 'relative' }}>
                    <img src={selImg} onError={handleImgError} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} alt="坐标卡星象" />
                    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 65%, rgba(7,9,20,0.95) 100%)' }} />
                  </div>
                  <div style={{ padding: '8px 14px 10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '12px', color: '#c9a96e', letterSpacing: '0.06em', fontWeight: 600 }}>✦ {postcard.catLabel}</span>
                      <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.45)', letterSpacing: '0.06em' }}>{postcard.oid} / {postcard.date}</span>
                    </div>
                    <div style={{ fontSize: '16px', fontWeight: 600, color: '#f4f7ff', letterSpacing: '0.04em', marginTop: '4px' }}>
                      你是 深汕气象天文馆 第{' '}
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          const next = prompt(
                            '【设置/重置观测者序号】\n请输入起始序号（输入 1 将重置为 001）：',
                            String(parseInt(postcard.no, 10) || 1)
                          );
                          if (next && next.trim()) {
                            const num = parseInt(next.trim(), 10);
                            if (!isNaN(num) && num >= 1) {
                              const pad = String(num).padStart(3, '0');
                              localStorage.setItem(SEQ_STORAGE_KEY, String(num));
                              pickImage(selImg, pad);
                              setDownloadSuccessTip(`观测者序号已成功设置为第 ${pad} 号`);
                              setTimeout(() => setDownloadSuccessTip(''), 3000);
                            }
                          }
                        }}
                        title="点击可修改或重置观测者序号（如重置为 001）"
                        style={{
                          color: '#ffd76a', fontSize: '22px', fontWeight: 700, padding: '0 2px',
                          cursor: 'pointer', textDecoration: 'underline dotted',
                          transition: 'color 0.2s'
                        }}
                      >
                        {postcard.no}
                      </span>{' '}
                      号观测者
                    </div>
                  </div>
                </div>

                {/* 2. 中间：垂直分隔细线 */}
                <div style={{ width: '1px', height: '180px', background: 'rgba(255, 255, 255, 0.12)', flexShrink: 0 }} />

                {/* 3. 右侧：大尺寸高清晰度二维码与操作区 */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '16px', fontWeight: 500, letterSpacing: '0.06em', color: '#f5f7ff' }}>
                      宇宙已接收到你的请求
                    </div>
                    <div style={{ fontSize: '12px', color: '#c9a96e', letterSpacing: '0.05em', marginTop: '2px' }}>
                      ✦ 专属宇宙坐标卡 · 手机扫码带走 ✦
                    </div>
                  </div>

                  {/* 放大至 175px x 175px 的高对比度白底二维码，极大增强手机识别率 */}
                  <div style={{
                    width: '175px', height: '175px', borderRadius: '12px', background: '#ffffff',
                    padding: '8px', boxSizing: 'border-box', boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    {qrUrl ? (
                      <img src={qrUrl} style={{ width: '100%', height: '100%', display: 'block' }} alt="扫码下载二维码" />
                    ) : (
                      <div style={{ fontSize: '12px', color: '#666' }}>生成中...</div>
                    )}
                  </div>

                  {/* 成功推进观测者序号提示 */}
                  {downloadSuccessTip && (
                    <div style={{
                      fontSize: '12px', color: '#ffd76a', background: 'rgba(201,169,110,0.18)',
                      border: '1px solid rgba(201,169,110,0.4)', padding: '4px 12px', borderRadius: '6px'
                    }}>
                      ✦ {downloadSuccessTip}
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'rgba(255,255,255,0.6)' }}>
                    <span>微信/相机扫码保存到相册</span>
                    <span
                      onClick={() => {
                        const next = prompt(
                          '【手机 4G/5G 扫码下载地址设置】\n\n' +
                          '• 当前已上线 GitHub Pages 网站：\n' +
                          '  https://alkene-dt.github.io/Alkene_shenshan-D1-sky/\n\n' +
                          '• 若使用 Vercel，请输入：\n' +
                          '  https://your-project.vercel.app/\n\n' +
                          '• 若连接展厅 WiFi，请输入电脑局域网 IP：\n' +
                          '  10.88.8.21:4185\n\n' +
                          '当前配置：',
                          serverHost
                        );
                        if (next && next.trim()) {
                          const clean = normalizeServerUrl(next.trim());
                          localStorage.setItem('SHENSHAN_SERVER_HOST', clean);
                          setServerHost(clean);
                          if (selImg) pickImage(selImg);
                        }
                      }}
                      title="点击可修改 4G/5G 公网网址或展厅局域网 IP"
                      style={{ color: '#c9a96e', cursor: 'pointer', textDecoration: 'underline', opacity: 0.9 }}
                    >
                      [{serverHost.includes('github.io') ? 'GitHub公网' : (serverHost.startsWith('http') ? '4G公网/域名' : `IP:${serverHost.split(':')[0]}`)} ✎]
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', marginTop: '2px' }}>
                    <button
                      onClick={handleDownloadPostcard}
                      style={{
                        padding: '7px 14px', borderRadius: '9px',
                        border: '1px solid rgba(201,169,110,0.6)',
                        background: 'linear-gradient(135deg, #c9a96e, #e8c36a)',
                        color: '#0a0d1a', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                        boxShadow: '0 4px 14px rgba(201,169,110,0.3)',
                        display: 'flex', alignItems: 'center', gap: '4px'
                      }}
                      title="下载到本机并使观测者序号 +1"
                    >
                      <span>⤓</span> 下载到本机
                    </button>
                    <button
                      onClick={handleConfirmMobileScan}
                      style={{
                        padding: '7px 12px', borderRadius: '9px',
                        border: '1px solid rgba(140,200,255,0.4)',
                        background: 'rgba(30,50,90,0.7)',
                        color: '#d6e8ff', fontSize: '13px', fontWeight: 500, cursor: 'pointer',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                        display: 'flex', alignItems: 'center', gap: '4px'
                      }}
                      title="手机扫码后点击，使观测者序号递增 +1"
                    >
                      <span>✓</span> 完成扫码带走
                    </button>
                    <button
                      onClick={() => { setPostcard(null); setSelImg(''); setQrUrl(''); setSelectedIdx(null); setDownloadSuccessTip(''); }}
                      style={{
                        padding: '7px 12px', borderRadius: '9px',
                        border: '1px solid rgba(255,255,255,0.22)',
                        background: 'rgba(255,255,255,0.08)',
                        color: '#f0f3fa', fontSize: '13px', cursor: 'pointer'
                      }}
                    >
                      ⟲ 重新选牌
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.45)', fontSize: '13px', letterSpacing: '0.06em', padding: '12px 0' }}>
                ✦ 点击下方卡牌 · 定制你的专属宇宙坐标卡 ✦
              </div>
            )}
          </div>

          {/* 下方区域：超大折叠弧形卡牌区（占满剩余高度，由于 cy 几何锚定，永不与上方重叠） */}
          <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
            <div
              ref={fanRef}
              onPointerDown={(e) => {
                resetIdle();
                dragRef.current = {
                  isDragging: true,
                  startX: e.clientX,
                  startOffset: scrollOffset,
                  hasMoved: false,
                };
              }}
              onPointerMove={(e) => {
                if (!dragRef.current.isDragging) return;
                const dx = e.clientX - dragRef.current.startX;
                if (Math.abs(dx) > 6) dragRef.current.hasMoved = true;
                const sensitivity = cardW * 0.75;
                const targetOffset = dragRef.current.startOffset - (dx / sensitivity);
                setScrollOffset(Math.max(minOffset - 0.45, Math.min(maxOffset + 0.45, targetOffset)));
              }}
              onPointerUp={() => {
                if (dragRef.current.isDragging) {
                  dragRef.current.isDragging = false;
                  setScrollOffset(prev => Math.max(minOffset, Math.min(maxOffset, prev)));
                }
              }}
              onPointerCancel={() => {
                dragRef.current.isDragging = false;
                setScrollOffset(prev => Math.max(minOffset, Math.min(maxOffset, prev)));
              }}
              onWheel={(e) => {
                resetIdle();
                const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
                setScrollOffset(prev => {
                  const next = prev + (delta > 0 ? 0.35 : -0.35);
                  return Math.max(minOffset, Math.min(maxOffset, next));
                });
              }}
              onClick={(e) => { if (e.target === e.currentTarget && !dragRef.current.hasMoved) setSelectedIdx(null); }}
              style={{
                flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden',
                cursor: n > 6 ? (dragRef.current.isDragging ? 'grabbing' : 'grab') : 'default',
                userSelect: 'none', touchAction: 'none'
              }}>
              {galItems.map((it, i) => {
                const theta = (i - scrollOffset) * angleStep;
                const x = cx + R * Math.sin(theta);
                const y = cy - R * Math.cos(theta);
                const rot = (theta * 180) / Math.PI;
                const isSel = selectedIdx === i;

                // 超出可视弧度的卡牌平滑渐隐并禁用交互
                const isOut = Math.abs(theta) > spreadR * 0.85;
                const cardOpacity = isOut ? 0 : Math.max(0, 1 - Math.pow(Math.abs(theta) / (spreadR * 0.72), 4));

                // 抽牌：沿弧线径向向外滑出
                const outX = Math.sin(theta) * outDist;
                const outY = -Math.cos(theta) * outDist;
                const transform = galleryIn
                  ? (isSel
                      ? `translate(-50%,-50%) translate(${outX}px, ${outY}px) scale(${selScale}) rotate(${rot}deg)`
                      : `translate(-50%,-50%) rotate(${rot}deg)`)
                  : 'translate(-50%,-50%) translateY(200px)';

                const zIndex = isSel ? 100 : Math.max(1, 60 - Math.round(Math.abs(theta) * 35));

                return (
                  <button key={i}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (dragRef.current.hasMoved) return; // 拖拽滑动时不触发点击
                      setSelectedIdx(i);
                      pickImage(it.file);
                    }}
                    title={it.label || selCat.title}
                    style={{
                      position: 'absolute', left: x, top: y, width: cardW, height: cardH,
                      zIndex, padding: 0, cursor: 'pointer', background: 'transparent', border: 'none',
                      transform, transformOrigin: '50% 50%',
                      opacity: galleryIn ? (selectedIdx !== null && !isSel ? cardOpacity * 0.85 : cardOpacity) : 0,
                      pointerEvents: isOut ? 'none' : 'auto',
                      transition: dragRef.current.isDragging ? 'transform 0.08s ease-out, opacity 0.15s' : 'transform 0.4s cubic-bezier(0.22,1,0.36,1), opacity 0.35s',
                    }}>
                    <img src={it.file} onError={handleImgError} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '14px',
                      border: isSel ? '3px solid #e8c36a' : '2px solid rgba(255,255,255,0.32)',
                      boxShadow: isSel ? '0 0 45px rgba(232,195,106,0.5), 0 20px 45px rgba(0,0,0,0.65)' : '0 14px 32px rgba(0,0,0,0.55)' }} />
                    {it.label && (
                      <span style={{ position: 'absolute', left: '50%', top: 8, transform: 'translateX(-50%)', whiteSpace: 'nowrap',
                        fontSize: 12, fontWeight: 500, color: '#fff', padding: '3px 10px', borderRadius: '999px',
                        background: 'rgba(8,11,22,0.85)', border: '1px solid rgba(200,180,255,0.38)', letterSpacing: '0.04em' }}>{it.label}</span>
                    )}
                  </button>
                );
              })}

              {/* 左右滑动翻页辅助箭头 */}
              {n > 6 && (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); resetIdle(); setScrollOffset(p => Math.max(minOffset, p - 1)); }}
                    style={{
                      position: 'absolute', left: 24, top: '50%', transform: 'translateY(-50%)',
                      zIndex: 80, width: 44, height: 44, borderRadius: '50%',
                      background: 'rgba(12,16,28,0.7)', border: '1px solid rgba(255,255,255,0.25)',
                      color: '#fff', fontSize: '24px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      opacity: scrollOffset <= minOffset + 0.1 ? 0.25 : 0.85,
                      transition: 'opacity 0.3s, background 0.2s',
                    }}
                    title="向前滑动"
                  >
                    ‹
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); resetIdle(); setScrollOffset(p => Math.min(maxOffset, p + 1)); }}
                    style={{
                      position: 'absolute', right: 24, top: '50%', transform: 'translateY(-50%)',
                      zIndex: 80, width: 44, height: 44, borderRadius: '50%',
                      background: 'rgba(12,16,28,0.7)', border: '1px solid rgba(255,255,255,0.25)',
                      color: '#fff', fontSize: '24px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      opacity: scrollOffset >= maxOffset - 0.1 ? 0.25 : 0.85,
                      transition: 'opacity 0.3s, background 0.2s',
                    }}
                    title="向后滑动"
                  >
                    ›
                  </button>
                </>
              )}
            </div>
            <p style={{ flex: '0 0 auto', textAlign: 'center', margin: '.2rem 0 0', fontSize: '13px', color: 'rgba(255,255,255,0.5)', letterSpacing: '0.05em' }}>
              {postcard ? '点击其他卡片 · 可更换选择' : (n > 6 ? '左右拖拽或滚动滑轮可转动卡牌 · 点击生成你的宇宙坐标卡' : '点击一张牌 · 生成你的宇宙坐标卡')}
            </p>
          </div>

          {/* ═══ 二级界面左下角返回按钮 ═══ */}
          <button
            onClick={() => {
              setState('spread');
              setPostcard(null);
              setSelImg('');
              setQrUrl('');
              setSelectedIdx(null);
              setDownloadSuccessTip('');
            }}
            style={{
              position: 'absolute', left: '34px', bottom: '26px', zIndex: 150,
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '10px 22px', borderRadius: '12px',
              background: 'rgba(12, 16, 28, 0.88)',
              border: '1.5px solid rgba(201, 169, 110, 0.5)',
              color: '#f4f7ff', fontSize: '14px', fontWeight: 500, letterSpacing: '0.06em',
              cursor: 'pointer', backdropFilter: 'blur(16px)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.6), 0 0 20px rgba(201,169,110,0.18)',
              transition: 'all 0.25s cubic-bezier(0.22, 1, 0.36, 1)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#ffd76a';
              e.currentTarget.style.transform = 'translateY(-2px) scale(1.03)';
              e.currentTarget.style.boxShadow = '0 12px 30px rgba(0,0,0,0.7), 0 0 25px rgba(255,215,106,0.3)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(201, 169, 110, 0.5)';
              e.currentTarget.style.transform = 'translateY(0) scale(1)';
              e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.6), 0 0 20px rgba(201,169,110,0.18)';
            }}
            title="返回分类选择"
          >
            <span style={{ fontSize: '18px', color: '#ffd76a', lineHeight: 1 }}>←</span>
            <span>返回分类</span>
          </button>
        </div>
      )}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
}
