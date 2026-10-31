import type { Capabilities, ProjectFile } from './types.js';

const MAX_SCAN = 1024 * 1024;
const SKIP_DIRS = ['node_modules', '.build', '.git', 'Pods'];
const CODE_EXT = /\.(swift|m|mm|h|kt|java|js|jsx|ts|tsx|mjs|cjs|py|go|rs|rb|php|plist|yml|yaml|json|toml|entitlements)$/i;
const SERVER_CODE = /\.(js|jsx|ts|tsx|mjs|cjs|py|go|rb|php|swift)$/i;

function skipped(path: string): boolean {
  const parts = path.split('/');
  return parts.some((p) => SKIP_DIRS.includes(p));
}

interface Scanned {
  path: string;
  text: string;
}

export function deriveCapabilities(files: ProjectFile[]): Capabilities {
  const all: Scanned[] = [];
  for (const f of files) {
    const path = f.path.replace(/\\/g, '/');
    if (skipped(path)) continue;
    all.push({ path, text: f.content.length > MAX_SCAN ? f.content.slice(0, MAX_SCAN) : f.content });
  }
  const code = all.filter(
    (f) => CODE_EXT.test(f.path) || /(^|\/)(Podfile|Package\.swift)$/.test(f.path),
  );
  const anyCode = (re: RegExp): boolean => code.some((f) => re.test(f.text));
  const pathHas = (re: RegExp): boolean => all.some((f) => re.test(f.path));

  const usesCamera = anyCode(/NSCameraUsageDescription|AVCaptureDevice|AVCaptureSession/);
  const usesMicrophone = anyCode(/NSMicrophoneUsageDescription|AVAudioSession[\s\S]{0,200}record|\.record\b[\s\S]{0,100}AVAudioSession/);
  const usesLocation = anyCode(/CLLocationManager|NSLocation\w*UsageDescription/);
  const usesPhotos = anyCode(/PHPhotoLibrary|PhotosUI|NSPhotoLibrary\w*UsageDescription|PHPickerViewController/);
  const usesTracking = anyCode(/ATTrackingManager|NSUserTrackingUsageDescription|ASIdentifierManager|\bAdSupport\b/);

  const hasSubscriptions = anyCode(/Product\.SubscriptionInfo|\.subscription\b|SubscriptionStoreView|auto-?renewable/i);
  const hasInAppPurchases =
    hasSubscriptions || anyCode(/\bStoreKit\b|SKPaymentQueue|SKProduct\b|SKPayment\b/);

  const usesFirebase =
    pathHas(/GoogleService-Info\.plist$/) ||
    anyCode(/import\s+Firebase\w*|FirebaseApp\.configure|firebase-ios-sdk/i) ||
    code.some((f) => /Package\.swift$|Podfile$/.test(f.path) && /firebase/i.test(f.text));

  const providers = new Set<string>();
  if (anyCode(/GoogleSignIn|Sign in with Google|GIDSignIn/i)) providers.add('google');
  if (anyCode(/FBSDKLoginKit|FacebookLogin|FBSDKLoginManager/)) providers.add('facebook');
  if (anyCode(/TwitterLogin|TWTRTwitter|Sign in with (Twitter|X)\b|XLogin|TwitterKit/i)) providers.add('twitter');
  const socialProviders = [...providers];

  const hasSignInWithApple = anyCode(/ASAuthorizationAppleIDProvider|SignInWithAppleButton|ASAuthorizationAppleIDButton/);

  const hasUserAccounts =
    socialProviders.length > 0 ||
    hasSignInWithApple ||
    anyCode(/\b(login|signup|sign_up|register|signIn|signUp|createAccount|FirebaseAuth)\b|SecureField|type=["']password["']/i) ||
    anyCode(/\bimport\s+FirebaseAuth\b/);

  const hasAuthTokens = anyCode(/\b(accessToken|refreshToken|access_token|refresh_token)\b|Bearer\s|\bJWT\b|jsonwebtoken/i);

  const hasBackend =
    all.some((f) => /(^|\/)(server|backend)\//.test(f.path)) ||
    pathHas(/(^|\/)supabase\/functions\//) ||
    all.some((f) => /(^|\/)package\.json$/.test(f.path) && /"(express|fastify|koa|hono)"/.test(f.text)) ||
    all.some((f) => /Package\.swift$|Package\.resolved$/.test(f.path) && /\bvapor\b/i.test(f.text));

  const usesExternalApis = anyCode(/URLSession|URL\(string:\s*"https?:\/\//);
  const usesWebView = anyCode(/WKWebView|\bWebView\b|SFSafariViewController/);
  const usesAI = anyCode(/\b(openai|anthropic|ollama|chatgpt|langchain)\b|api\.openai\.com|api\.anthropic\.com/i);
  const hasDeepLinks = anyCode(/CFBundleURLTypes|onOpenURL|applinks:|com\.apple\.developer\.associated-domains/);

  const hasExternalPaymentLinks = code.some(
    (f) =>
      /stripe\.com\/(checkout|pay)|checkout\.stripe\.com|buy\.stripe\.com|paypal\.com/i.test(f.text) &&
      /openURL|UIApplication\.shared\.open|\bLink\(|\.open\(/.test(f.text),
  );

  const hasOtpFlow = anyCode(/\botp\b|verificationCode|verification_code/i);
  const hasPasswordReset = anyCode(/resetPassword|reset_password|forgot[\s_-]?password|sendPasswordReset/i);
  const hasAdminRoles = anyCode(/\bisAdmin\b|role\s*(==|===|:|=)\s*["']admin["']|["']admin["']\s*(===|==)/i);

  const hasUserControlledUrlFetch = code.some(
    (f) =>
      SERVER_CODE.test(f.path) &&
      (/\b(fetch|axios(\.\w+)?|got|request|http\.get|https\.get)\(\s*req\.(body|query|params)\.\w+/.test(f.text) ||
        (/=\s*req\.(body|query|params)\.\w*url\w*/i.test(f.text) && /\b(fetch|axios|got)\s*\(/.test(f.text))),
  );

  const hasCiWorkflows = all.some((f) => /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(f.path));

  const targetsAppStore =
    all.some((f) => /(^|\/)(Info\.plist|xtool\.yml)$/.test(f.path)) ||
    all.some((f) => /(^|\/)Package\.swift$/.test(f.path) && /\.iOS\b/.test(f.text)) ||
    pathHas(/\.xcodeproj\/project\.pbxproj$/);

  const processesPersonalData =
    usesLocation || usesCamera || usesPhotos || hasUserAccounts ||
    anyCode(/\b(emailAddress|phoneNumber|dateOfBirth|birthdate|birthDate|HKHealthStore|CNContactStore|firstName|lastName)\b/);

  return {
    targetsAppStore, hasUserAccounts, hasSocialLogin: socialProviders.length > 0, socialProviders,
    hasSignInWithApple, hasSubscriptions, hasInAppPurchases, usesFirebase, hasBackend,
    usesExternalApis, processesPersonalData, usesCamera, usesMicrophone, usesLocation, usesPhotos,
    usesTracking, usesWebView, usesAI, hasAuthTokens, hasDeepLinks, hasExternalPaymentLinks,
    hasOtpFlow, hasPasswordReset, hasAdminRoles, hasUserControlledUrlFetch, hasCiWorkflows,
  };
}
