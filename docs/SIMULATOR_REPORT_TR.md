# Open iOS Studio — yerel Swift çalışma ortamı mühendislik raporu

Tarih: 17 Kasım 2026. Dal: `feature/local-swift-simulator`. İlk başlangıç: yerel `32422e6`; entegrasyon tabanı: güncel upstream `bc72cc1` (v0.1.12). Çalışma kopyası: `/home/melih-cevirim/Desktop/ios simülatör/open-ios-studio`.

## Teslim edilen aşama

Linux üzerinde gerçek Swift uygulama kodunu derleyip ayrı bir süreçte çalıştıran, etkileşimleri Swift callback'lerine ileten ve arayüzünü IDE içinde yerel çizen deneysel bir kaynak uyumluluğu ortamı geliştirildi. Bu, Apple'ın resmi iOS Simulator ürünü değildir. Tam iOS işletim sistemi, ARM emülatörü veya `.ipa` çalıştırıcısı değildir. Yansıtma, fiziksel iPhone ve uzaktaki Mac kullanılmaz.

Mevcut masaüstü kaynakları `open-ios-studio-yayin` klasöründe bulundu. Orijinal çalışma dalına dokunmadan bu görev klasöründe ayrı Git çalışma kopyası/dalı oluşturuldu. Kurulu `/usr/bin/open-ios-studio` uygulamasının paketi değiştirilmedi. Güncel main üzerine entegre edilen yeni Tauri uygulaması Mint masaüstünde açıldı; yerel debug DEB üretildi ve içindeki gerçek Swift yürütmesi doğrulandı. Eksik geliştirme paketleri yönetici kurulumu olmadan `/tmp` altına çıkarıldı. [Masaüstü ve paket doğrulaması](SIMULATOR_DESKTOP_VERIFICATION.md).

## Tersine mühendislik kanıtı

`reverse-engineer-and-rebuild` becerisi GitHub'dan `~/.codex/skills/reverse-engineer-and-rebuild` konumuna kuruldu. SKILL.md, targets.md ve fallback.md yönergeleri okundu; gözlem → bağımsız uygulama → karşılaştırılabilir yerel test → düzeltme akışı uygulandı.

Yetkili bir macOS/Apple Simulator referans ortamı ve kurulu REA bulunmadığından, Apple davranışına göre birebir doğrulama yapılmadı. Kaynak incelemesi, resmi dokümantasyon, gerçek Swift derleyicisi ve süreç çıktıları kullanıldı. Bunlar REA kanıtı olarak etiketlenmedi. Apple ile görsel/davranışsal eşleşme durumları **UNKNOWN** bırakıldı. Özgün ekran görüntüsü olmadan pixel-diff/verdict araçlarıyla sahte olumlu sonuç oluşturulmadı.

Kaynaklar, mimari alternatifler ve girdi/beklenen çıktı/kanıt kapsamı tablosu: [fizibilite ve kanıt defteri](research/LOCAL_SIMULATOR_FEASIBILITY.md). Swift, Apple State/NavigationStack belgeleri, Tokamak, OpenSwiftUI, wgpu, Skia ve LLVM Mach-O kaynakları incelendi. Bu projelerden uygulama kodu kopyalanmadı; Apple SDK/binary/grafik varlıkları dağıtılmadı.

## Seçilen mimari

`Swift kaynakları → swiftc + özgün SwiftUI modülü → yerel yürütülebilir süreç → JSON arayüz ağacı → Rust Engine → React/Tauri yerel çizimi`.

Tıklama ve klavye olayları aynı zincirin tersinden süreç stdin'ine gider; Swift closure'ları uygulama durumunu değiştirir, yeni arayüz ağacı üretilir. Kaynak metinden regex ile HTML oluşturulmaz. Swift'in aritmetiğini veya callback sonuçlarını JavaScript taklit etmez.

Derleme ve süreç yönetimi IDE'den ayrıdır. Mevcut shell kullanmayan runner, argüman vektörü, ortam temizliği, zaman aşımı ve iptal kullanılır. Kaynak seçiminde workspace dışına geçiş/symlink kaçışı engellenir. SwiftPM manifestleri ve build plugin'leri çalıştırılmaz. İlk sürüm, seçilen dosyanın doğrudan kardeş Swift dosyalarını birlikte derler; proje bağımlılık çözümü ve recursive kaynak keşfi henüz yoktur.

Çizim, mevcut yerel webview üzerinden yapılır. Bu, native Skia/wgpu motoru değildir. wgpu/Skia, ayrı renderer sınırının sonraki uygulamaları olarak değerlendirildi. Webview metin ölçümü, yerleşim, kırpma, giriş ve kaydırma sağlar; iOS yerleşim/animasyon/scroll fiziği eşdeğerliği iddia edilmez.

## Çalışan davranışlar ve bileşenler

Yerel olarak doğrulananlar:

- `App`, `WindowGroup`, `View`, result builder ve gerçek Swift derlemesi.
- `Text`, `Button`, `VStack`, `HStack`, `ScrollView`, temel `List`.
- Kök görünümde tutulan `@State` ve çocuk görünümlere geçirilen gerçek `@Binding`.
- `TextField`, `SecureField`, `Toggle`, `Slider`.
- Temel `NavigationStack` / `NavigationLink` ileri/geri akışı.
- `TabView(selection:)`, integer `tag`, `tabItem`; seçim Swift durumunu değiştirir.
- Boolean binding üzerinden sheet/alert açma ve kapatma.
- Derleme başarısız olduğunda önceki başarılı uygulamanın etkileşimli kalması.
- Yeniden derleme/başlatma, durdurma, paneli kapatma, kaydedince debounced derleme altyapısı.
- Monaco'da dosya/satır/sütun derleyici hata işaretleri ve sınırlı günlük tamponu.
- Yaklaşık cihaz profili, yön, ölçek, açık/koyu görünüm, tam ekran kontrolü ve kendi yerel arayüzünden SVG dışa aktarma.

Temel `padding`, `frame`, `font`, `foregroundStyle`/`foregroundColor`, `background`, `cornerRadius`, `opacity`, `offset` bildirimleri uygulanmıştır; tüm overload'lar ve SwiftUI layout proposal/alignment davranışı yoktur. `ZStack`, `Spacer`, `ProgressView` uygulanmıştır; bileşenlere özel kapsamlı runtime/referans doğrulaması tamamlanmamıştır.

`Image(systemName:)`, desteklenmeyen sembolü açık bir metin yer tutucusuyla gösterir; SF Symbols veya asset decoder sunmaz. Rastgele iç içe görünümlerin `@State` kimlik yönetimi, Observable modeller, iOS servisleri, gesture API'leri, SwiftUI animation API'leri, kalıcı uygulama verisi, sanal klavye ve tam erişilebilirlik uyumluluğu desteklenmez. Yeniden başlatma bellek durumunu sıfırlar; hot reload sırasında durumu korumaz. Temel gezinme, süreç başına tek global stack kullanır.

Tam bileşen/sınır tablosu: [kullanım ve uyumluluk kılavuzu](LOCAL_SIMULATOR.md).

## Yürütülen testler

| Kontrol | Sonuç | Kapsam / sınır |
| --- | --- | --- |
| `npm run verify` | PASS | Typecheck, ESLint, 435 Vitest testi, üretim web derlemesi, politika katalogları ve gate self-test |
| E2E TypeScript kontrolü | PASS | Yeni Node tabanlı test köprüsünün türleri dahil |
| Rust bağımsız üretim kodu harness'i | PASS | 36 filesystem/runner/xtool/simulator birim testi + 3 gerçek Swift/paket sözleşmesi entegrasyon testi |
| Clippy `-D warnings` | PASS | Tüm Tauri crate’i, tüm hedefler, `-D warnings` |
| Rustfmt | PASS | Ana crate ve harness |
| Tarayıcı regresyon paketi | PASS | 62 Playwright testi; masaüstünde bulunan klasör geçişi düzeltmesi ayrıca kontrol edildi. Simülatör vakasında gerçek Rust/Swift, diğer IDE servislerinde mock |
| `scripts/doctor.sh --self-test` | PASS | Yansıtma tavsiyesi kaldırıldıktan sonraki script kontrolü |
| Tam Tauri Rust testi/masaüstü derlemesi | PASS | 129 test, tam debug masaüstü derlemesi, Mint’te gerçek pencere ve editör → derleme → etkileşim |
| Windows 11 | NOT_VERIFIED | Native Windows Swift/NSIS uygulaması PR #59 kapsamında; Windows Server CI kanıtı gerçek Windows 11 masaüstü kontrolünün yerine geçmez |
| Apple Simulator karşılaştırması | UNKNOWN | Yetkili macOS referansı yok |
| Yerel DEB / paket kontrolü | PASS | Debug DEB kaynak/örnek/lisans hash’leri, çıkarılan uygulamanın `--simulator-info` ve gerçek Swift callback smoke testi |
| GitHub CI / dağıtım | PR üzerinden izleniyor | Release etiketi veya herkese açık sürüm bu çalışma tarafından oluşturulmadı |

Gerçek süreç testinde sayaç 0 → 1 → 2 → 3 ilerledi; toggle kapatılınca Swift koşulu artışı engelledi. Kaynak kodundaki başlangıç 40 ve callback `+7` yapıldığında tek tıklama **47** üretti. Bu, sabit JavaScript sayaç sonucuna dayanmadığını doğrular. Unicode metin ve secure-field karakter sayısı, slider, navigation, sheet/alert, child Binding, native tab selection, hatalı derlemede eski sürecin korunması ve yeniden başlatma test edildi.

Tarayıcıda hızlı Türkçe yazma, Swift'ten gelen greeting, düğme, gezinme, sheet, sekme, liste kaydırma, görünüm/yön, SVG indirme, Monaco hata işareti ve hata sonrası sayaç etkileşimi doğrulandı. `test-results/` ekran görüntüsü, SVG ve `native-runtime-transcript.json` içerir; bunlar Apple referansı değil, bizim yerel runtime kanıtlarımızdır.

## Linux ve Windows

Makine: Linux Mint 22.3 x86_64, Swift 6.4.2, Rust 1.99.1. Sistem Node 18 proje gereksinimini karşılamadığından mevcut Node 24.22.3 runtime'ı ile frontend kontrolleri çalıştırıldı. Proje Node >=22 ister.

Linux Swift yürütme, üretim Rust Engine’i, tarayıcı renderer bağlantısı ve gerçek Tauri masaüstü penceresi test edildi. Monaco’da başlangıç değeri 40 yapılıp kaydedildi; yeniden derleme 40, tıklama 41 üretti. Yerel debug DEB’in çıkarılan uygulaması da test edildi. Yöneticiyle sistem kurulumu, AppImage masaüstü açılışı ve tüm Linux dağıtımları doğrulanmadı. Sistem paketleri değiştirilmedi.

Native Windows derleme/linkleme/DLL yükleme, Job Object süreç temizliği ve NSIS paketleme eklendi. Windows CI gerçek Swift etkileşimlerini ve kurulan paketin kaynak hash/callback testini çalıştırır; kurulu WebView2 arayüzü de ayrı uçtan uca test edilir. Güncel sonuçlar PR #59 ve [Windows kılavuzunda](WINDOWS_SIMULATOR.md) izlenir. Gerçek Windows 11 kullanıcı masaüstü doğrulaması ayrıdır. Swift araç zinciri, Visual Studio ve Windows SDK ayrıca kurulur; Apple framework desteği eklenmiş değildir.

## Kaynak ve ikili uyumluluk

**Kaynak:** belgelenmiş dar SwiftUI alt kümesi için gerçek native Swift derleme/yürütme mevcut. UIKit, tam SwiftUI, üçüncü taraf paketler ve genel Xcode projeleri desteklenmez; eksik API'ler derleyici hatası üretir.

**İkili:** Mach-O/ARM64/iOS ABI, dynamic linker, Objective-C runtime, Darwin syscall ve Apple framework bağımlılıklarını karşılayan bir yükleyici yoktur. `.ipa` veya `.app` çalıştırma desteği iddia edilmez. Derleyici çıktısı çalışılan Linux veya Windows host’u için native yürütülebilirdir.

## Değiştirilen dosyalar

- `runtime/SwiftUI/SwiftUI.swift`: özgün modül, state/binding, UI ağacı, callback protokolü.
- `examples/LocalSimulator/Counter.swift`, `examples/BindingAndTabs/Demo.swift`: gerçek derlenen örnekler.
- `src-tauri/src/simulator/{mod,engine}.rs`, `src-tauri/src/lib.rs`: lifecycle, derleme, native süreç, IPC.
- `src/simulator/{types,SimulatorPanel,SimulatorCanvas,simulator.css}`: renderer ve simülatör paneli.
- `src/App.tsx`, `src/components/{ActivityBar,EditorPane}.tsx`, `src/ipc.ts`: IDE ve Monaco bağlantısı.
- `src-tauri/src/doctor.rs`, `src/xtool/doctor.ts`, ilgili test, `scripts/doctor.sh`, `docs/ENVIRONMENT.md`: UxPlay/yansıtma keşfi ve tavsiyelerinin kaldırılması.
- `tools/simulator-harness/`: aynı üretim kodunu GUI bağımlılıkları olmadan derleyen CLI ve test crate'i.
- `e2e/simulator.spec.ts`, `e2e/fakeTauri.ts`: native test köprüsü, davranış testleri; mevcut test fixture'ındaki eksik event-unregister API düzeltmesi.
- `package.json`, lockfile: test komutları ve `@types/node` geliştirme bağımlılığı. Yeni ürün bağımlılığı yok.
- `.github/workflows/ci.yml`: gerçek Swift/harness testleri, ardından browser E2E. Sonuçlar entegrasyon PR’ında izlenir.
- README, CLAUDE, STATUS, ROADMAP, ADR-0016, fizibilite, tasarım/plan, kullanım kılavuzu ve bu rapor.

## Çalıştırma komutları

Node >=22, Swift ve Rust kurulu ortamda:

```bash
cd '/home/melih-cevirim/Desktop/ios simülatör/open-ios-studio'
npm ci
npm run verify
npm run test:simulator
CHROMIUM_PATH=/usr/bin/google-chrome npm run e2e:simulator
```

GUI kütüphaneleri hazır olduğunda:

```bash
npm run tauri dev
```

IDE'de klasör aç → Simülatör → Örneği aç → Simülatörü başlat. Düzenlenen Swift dosyasını kaydedip yeniden derle. `npm run dev` tek başına native IPC sağlamaz; düz tarayıcıda simülatör çalıştırıldığı iddia edilmez.

## Sıradaki geliştirme aşamaları

1. Paket CI’ını tamamlamak; AppImage masaüstü açılışı ve farklı Linux dağıtımlarını ayrıca doğrulamak. Mint Tauri açılışı ve editörden Swift çalıştırma tamamlandı.
2. Yetkili macOS referans uygulamalarından aynı girdilerle state/layout/pixel kayıtları toplamak; becerinin comparison/verdict araçlarıyla gerçek karşılaştırma yapmak.
3. SwiftPM bağımlılık/kaynak grafiği, incremental derleme, derleyici tanıları ve durum koruyan reload.
4. İç içe görünüm kimliği, Observable modeller, bağımsız navigation stack'leri, lifecycle/environment ve daha geniş modifier API'si.
5. Native renderer adapter, metin shaping, iOS benzeri layout/hit testing, focus, gesture ve animasyon.
6. Kalıcı sanal cihaz/profil yönetimi, uygulama verisi izolasyonu, klavye, kaynak/asset çizimi ve PNG export.
7. Windows native toolchain/proses/DLL/graphics/paketleme doğrulaması; gerekirse açıkça belgelenen WSLg yolu.

Bu teslim, gerçek uygulama mantığı yürüten ilk doğrulanabilir kaynak uyumluluğu aşamasıdır; geniş çaplı iOS/SwiftUI veya ikili uyumluluk hedefinin tamamlandığı iddia edilmez.
