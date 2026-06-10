import path from 'node:path';

export const ROOT_DIR = '/Users/gd/Desktop/主业/客户教程视频自动化';
export function currentShanghaiDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

export const DEFAULT_OUTPUT_DIR = `/Users/gd/Desktop/主业/客户教程视频/稿定商品-AI优化商品图/${process.env.TUTORIAL_OUTPUT_DATE || currentShanghaiDate()}`;
export const CDP_BASE_URL = process.env.CDP_BASE_URL || 'http://localhost:3456';
export const NODE_MODULES_DIR = process.env.CODEX_NODE_MODULES_DIR ||
  '/Users/gd/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';

export const SINGLE_SHOP_URL = 'https://gdsp.huanleguang.com/app-douyin#/';
export const APP_HOME_URL = 'https://gdsp.huanleguang.com/app-pim/#/';
export const TARGET_URL = 'https://gdsp.huanleguang.com/app-pim/#/ai/background-swap';
export const REFERENCE_VIDEO_URL = 'https://www.douyin.com/video/7642683057119492601';
export const OFFICIAL_DOC_URL = 'https://www.yuque.com/huanleguang/hlgddgl/xgl71af4r29ngxpf';
export const TARGET_TEST_STORE = '道理门';

export const SENSITIVE_PATTERNS = [
  /旗舰版\s*剩余[:：]?\s*\d+天/g,
  /已选\d+个店铺/g,
  /测试使用/g,
  /店群剩余点数[:：]\s*\d+点/g,
  /当前cookie[:：]?/g,
  /当前token[:：]?/g,
  /proxy\.json[:：]?/g,
  /\d{3,4}\s?\d{4}\s?\d{4}/g
];

export function parseArgs(argv) {
  const flags = {
    dryRun: false,
    outputDir: DEFAULT_OUTPUT_DIR,
    keepTab: false,
    skipCapture: false,
    skipVoice: false,
    skipCompose: false,
    aspect: 'horizontal',
    style: 'all'
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--keep-tab') flags.keepTab = true;
    else if (arg === '--skip-capture') flags.skipCapture = true;
    else if (arg === '--skip-voice') flags.skipVoice = true;
    else if (arg === '--skip-compose') flags.skipCompose = true;
    else if (arg === '--aspect') {
      const aspect = argv[i + 1];
      if (!['all', 'horizontal', 'vertical'].includes(aspect)) {
        throw new Error(`invalid --aspect: ${aspect}`);
      }
      flags.aspect = aspect;
      i += 1;
    }
    else if (arg === '--style') {
      const style = argv[i + 1];
      if (!['all', 'nanny', 'shortform'].includes(style)) {
        throw new Error(`invalid --style: ${style}`);
      }
      flags.style = style;
      i += 1;
    }
    else if (arg === '--output') {
      flags.outputDir = path.resolve(argv[i + 1]);
      i += 1;
    }
  }

  return flags;
}
