# Kâtip (32-bit / Windows 7 sürümü)

Bu repo, [alicankala/katip](https://github.com/alicankala/katip) projesinin **32-bit (x86) ve Windows 7** hedefli koludur. Kendi GitHub release/otomatik güncelleme kanalını kullanır, böylece 64-bit sürümle karışmaz.

## Ana repodan farkları — değiştirmeden önce okuyun

Bu farklar keyfi değil, Windows 7 desteğinin zorunlu kıldığı şeylerdir. Herhangi birini geri almak uygulamanın Windows 7'de **açılmamasına** yol açar.

| Konu | Bu repo | Neden |
|---|---|---|
| Electron | **22.3.27** (sabit) | Electron 23+ Windows 7/8/8.1 desteğini kaldırdı. 22, Win7 çalıştıran son sürüm. Yükseltilirse üretilen `.exe` alt sistem sürümü 10.00 olur ve Win7 "geçerli bir Win32 uygulaması değil" hatası verir. |
| Modül biçimi | **CommonJS** (`package.json`'da `"type": "module"` yok) | Electron 22 ana süreçte ESModule çalıştıramıyor. Bu alan eklenirse `main.js` ESM üretilir ve uygulama açılmaz. |
| better-sqlite3 | **9.6.0** (sabit) | 10+ sürümlerin Electron 22 (ABI v110) için hazır 32-bit derlemesi yok; kaynaktan derleme Visual Studio + Python ister. |
| Dış HTTP istekleri | `node:https` (`marketController.ts`) | Electron 22'nin Node 16'sında global `fetch` yok (Node 18 ile geldi). Döviz kuru ve hava durumu bu yüzden `istekAt()` yardımcısını kullanır. |
| Güncelleme ağ katmanı | `NodeHttpExecutor` (`nodeHttpExecutor.ts`) | Chromium sertifikaları **Windows'un kök sertifika deposundan** doğrular; Windows 7'nin deposu 2020'den beri güncellenmediği için GitHub `ERR_CERT_AUTHORITY_INVALID` veriyordu. Node kendi gömülü CA listesini taşıdığı için istekler oraya taşındı. Electron'un `net` modülüne geri dönmeyin. |
| Arşivleme | `adm-zip` (`backupController.ts`) | Windows'un `tar.exe`'si ancak Windows 10 build 17063 ile geldi; Windows 7'de yok. `tar.exe` kullanılırsa yedekleme, geri yükleme ve sıfırlama bozulur. Uygulama kodunda **hiçbir dış program çağrısı olmamalı**. |
| Hedef mimari | yalnızca `ia32` | 64-bit kurulum dosyasıyla karışmasın diye; dosya adı da `-x86` eki taşır. |

Sürüm yükseltmesi gerekirse önce yukarıdaki tablodaki kısıtları doğrulayın.

## Derleme

```bash
npm install --ignore-scripts   # better-sqlite3 9.6.0'in guncel Node icin hazir derlemesi yok
npm run build                  # cikti: release/<surum>/Katip-Windows-x86-<surum>-Setup.exe
```

Native modül (better-sqlite3) doğru hedefe (Electron 22 / ia32) derlemeyi `electron-builder` kendi adımında yapar; bu yüzden kurulumda betikleri atlamak sorun çıkarmaz.

---

# Vue 3 + TypeScript + Vite

This template should help get you started developing with Vue 3 and TypeScript in Vite. The template uses Vue 3 `<script setup>` SFCs, check out the [script setup docs](https://v3.vuejs.org/api/sfc-script-setup.html#sfc-script-setup) to learn more.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur) + [TypeScript Vue Plugin (Volar)](https://marketplace.visualstudio.com/items?itemName=Vue.vscode-typescript-vue-plugin).

## Type Support For `.vue` Imports in TS

TypeScript cannot handle type information for `.vue` imports by default, so we replace the `tsc` CLI with `vue-tsc` for type checking. In editors, we need [TypeScript Vue Plugin (Volar)](https://marketplace.visualstudio.com/items?itemName=Vue.vscode-typescript-vue-plugin) to make the TypeScript language service aware of `.vue` types.

If the standalone TypeScript plugin doesn't feel fast enough to you, Volar has also implemented a [Take Over Mode](https://github.com/johnsoncodehk/volar/discussions/471#discussioncomment-1361669) that is more performant. You can enable it by the following steps:

1. Disable the built-in TypeScript Extension
   1. Run `Extensions: Show Built-in Extensions` from VSCode's command palette
   2. Find `TypeScript and JavaScript Language Features`, right click and select `Disable (Workspace)`
2. Reload the VSCode window by running `Developer: Reload Window` from the command palette.
