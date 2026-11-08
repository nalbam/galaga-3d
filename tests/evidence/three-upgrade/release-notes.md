# Three.js 0.160.0 → 0.187.0 업그레이드 분석

- 변경: `docs/game.js:1`의 import를 `https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js`에서 `https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.module.js`로 바꿨다. 다른 게임 코드는 바꾸지 않았다(아래 분석 결과 필요한 변경이 없었다).
- 기준 revision: `c7bd593`(업그레이드 전 `docs/game.js`).
- 원문: GitHub 릴리스 노트 `https://github.com/mrdoob/three.js/releases/tag/r161` … `…/tag/r187`(`gh api repos/mrdoob/three.js/releases/tags/rNNN`로 27개를 모두 받아 키워드와 해당 절을 대조했다), Migration Guide `https://github.com/mrdoob/three.js/wiki/Migration-Guide`의 r160→r161부터 r186→r187까지의 절.
- 게임이 쓰는 Three API(`docs/game.js`): `Scene`, `Fog(0x050713, 34, 100)`(17행), `PerspectiveCamera`(18행), `WebGLRenderer({ canvas, antialias:true, alpha:false })`, `setPixelRatio(min(dpr,2))`, `setClearColor(0x050713,1)`(20–21행), `setSize`(74행), `render`(114행), `MeshPhongMaterial({ color, emissive, emissiveIntensity:.75, flatShading:true })`(32행)와 wireframe·transparent 보호막(64행), `LineBasicMaterial({ transparent, opacity:.7 })`(33행), `PointsMaterial({ color, size:.09, transparent, opacity:.8 })`(69행), `GridHelper`(70행), `BufferGeometry.setFromPoints`(37행)·`setAttribute`(69행), `Float32BufferAttribute`, Cone/Sphere/Octahedron/Torus/Cylinder/BoxGeometry, `Vector3`, `MathUtils.clamp`(102행). 조명(`Light`)은 없다: `grep -c Light docs/game.js` 결과는 0이다.

## 항목별 판단

| 항목 | 원문 근거 | 게임 코드 | 판단 |
| --- | --- | --- | --- |
| WebGL 1 지원 제거 | r163 릴리스 노트 "WebGLRenderer – Remove WebGL 1 support. #27836, #27853, #27855, #27969", Migration Guide r162→r163 "WebGLRenderer has dropped WebGL 1". r181에서 "Remove WebGL 1.0 compatibility code. #32071"로 남은 호환 코드도 지웠다. | `new THREE.WebGLRenderer(...)`(20행) | **제약 변경.** 0.187.0은 WebGL2 컨텍스트만 만든다. WebGL2가 없는 브라우저·기기에서는 렌더러 생성자가 예외를 던지고 모듈 실행이 멈춘다. 그러면 시작 화면 HTML은 보이지만 캔버스가 그려지지 않고 START MISSION도 반응하지 않는다. 오류 처리 코드는 추가하지 않았다. 현재 주요 브라우저(Chrome·Edge 56+, Firefox 51+, Safari 15+)는 WebGL2를 지원한다. README의 Run locally에 WebGL2 요구를 적었다. |
| `stencil` 기본값 `false` | r163 "Set `stencil` to `false` by default. #27900, #27908", Migration Guide r162→r163 | 생성자 옵션에 `stencil`이 없고 stencil 버퍼를 쓰는 기능(Mask, clipping stencil)도 없다 | 영향 없음 |
| `useLegacyLights` 제거와 조명 단위 | r165 "Remove deprecated `useLegacyLights`. #28482"(물리 조명 단위는 r155부터 기본값이었고 0.160.0도 같다) | `useLegacyLights`를 쓰지 않는다. 조명 객체도 없다(`grep -c Light` = 0) | 영향 없음. Phong 재질의 색은 `emissive`와 `emissiveIntensity`만으로 결정된다 |
| 색 관리와 tone mapping | `ColorManagement.enabled`와 `outputColorSpace = SRGBColorSpace` 기본값은 r152에서 바뀌었고 r161–r187에서는 바뀌지 않았다. r167·r170·r171·r177·r187의 ColorManagement 항목은 `getLuminanceCoefficients()` 추가, `define()` 추가, 선형 출력 공간 수정, tree-shaking, 함수 이름 변경(Migration Guide r176→r177: `fromWorkingColorSpace`→`workingToColorSpace`), 변환 행렬 순서 수정(#34952, sRGB↔sRGB에서는 행렬을 쓰지 않음)이다. r168 "Remove the default value for `toneMapping`. #29101"은 ToneMappingNode(WebGPU/TSL) 항목이다. `WebGLRenderer.toneMapping` 기본값은 `NoToneMapping`으로 그대로다 | `outputColorSpace`, `toneMapping`, `ColorManagement`를 설정하지 않는다. 16진수 색은 sRGB로 해석되어 선형 작업 공간으로 변환된다(두 버전 동일) | 영향 없음. 측정 결과도 같다(아래 표, 휘도 차이 0) |
| `MeshPhongMaterial`, `emissive`, `emissiveIntensity`, `flatShading` | r162 "Material – Fix `emissiveIntensity` not persisting. #27769"(복사·직렬화 수정), r167·r179의 emissive 항목은 Node 재질 항목이다. r183 "MeshPhongMaterial – Add support for scene.environment IBL. #32795"는 `scene.environment`를 설정할 때만 적용된다. r176의 `flatShading` 수정은 NodeMaterial(WebGPU) 항목이다 | 32행 `mat()`, 64행 보호막. `scene.environment`를 설정하지 않는다 | 영향 없음 |
| `LineBasicMaterial` | r161–r187 릴리스 노트와 Migration Guide에 WebGLRenderer의 LineBasicMaterial 동작 변경이 없다 | 33행 `glowLine`(37행에서 `Mesh`에 붙여 사용), 70행 GridHelper 재질 | 영향 없음 |
| `PointsMaterial`의 `size`와 `sizeAttenuation` | r169 "SpriteNodeMaterial – Add `sizeAttenuation`. #29394", r180 "SpriteNodeMaterial – Honor `sizeAttenuation` for perspective camera only. #31628"은 WebGPU Node 재질이다. `PointsMaterial`의 기본값(`sizeAttenuation: true`)은 그대로다 | 69행 별 필드 `size:.09` | 영향 없음 |
| `Fog` | r163 "Apply fog before tonemapping and encoding. #27850", r166·r172·r179의 fog 항목은 WebGPU/Node 렌더러 항목이다. r182 "Improve `ShaderMaterial.fog`. #32224"는 ShaderMaterial 전용이다. Migration Guide r171→r172의 `rangeFog()`/`densityFog()` 폐지는 TSL 함수다 | 17행 `new THREE.Fog`, 74행 `fog.near/far` 갱신 | 영향 없음 |
| `GridHelper` | r162 "Improve `GridHelper` page. #27817, #27830"(문서) | 70행 | 영향 없음 |
| `WebGLRenderer` 옵션, `setPixelRatio`, `setClearColor`, `setSize` | r183 "Turn off antialiasing in compat mode. #32902", r185 "Handle antialias. #33446"는 WebGPURenderer 항목이다. Migration Guide r186→r187 "`setViewport()`/`setScissor()` no longer scale by pixel ratio when a render target is bound. #34460"은 렌더 타깃을 바인딩할 때만 적용된다. r187 "RenderOutputNode – Make `premultipliedAlpha` optional. #34948"과 Migration Guide r184→r185의 premultiplied alpha 변경은 WebGPURenderer 항목이다 | 20–21행, 74행. 렌더 타깃을 쓰지 않는다 | 영향 없음 |
| 지오메트리, `BufferGeometry`, `Float32BufferAttribute` | r162 "Float64BufferAttribute – Remove class. #27807"(게임은 Float32만 사용), r171 "BufferGeometry – Fix `setFromPoints()` when updating with smaller point sets. #29956"(갱신할 때만 해당, 게임은 생성 시 한 번만 호출), Migration Guide r175→r176 `CapsuleGeometry` 인수 이름 변경(게임은 사용하지 않음) | 37행, 69행, 36–92행의 지오메트리 생성 | 영향 없음 |
| 빌드 파일 구조와 CDN 경로 | r171 Global "Codesplit WebGL/WebGPU entrypoints. #29404, #29644". 0.187.0의 `build/three.module.js`는 `./three.core.js`를 import한다. r161에서 `build/three.js`·`three.min.js`를 지웠으나(Migration Guide r160→r161) 게임은 ES 모듈 빌드를 쓴다 | 1행 import | 경로는 그대로 쓸 수 있다. `three.core.js` 요청이 하나 늘어난다. `run.json`의 `runs.after.threeModules`에 두 응답(모두 200)이 기록되어 있다 |
| 콘솔 경고와 deprecation | 게임은 deprecated API(`Clock`, `PCFSoftShadowMap`, `copyTextureToTexture3D` 등)를 쓰지 않는다 | — | 두 실행의 콘솔 메시지(`runs.before.console`, `runs.after.console`)가 모두 비어 있다. `newWarningsAfter`도 비어 있다 |

## 브라우저 비교 (headless Chromium 158.0.8127.18, SwiftShader)

`PLAYWRIGHT_PREFIX=~/pw node tests/browser/three-upgrade-compare.mjs`(종료 코드 0)로 측정했다. 조건은 800x900, deviceScaleFactor 1, mulberry32 시드 `20261108`, 가상 60 Hz 프레임 클록, 같은 입력 순서다. 자세한 값은 `run.json`에 있다.

"눈에 띄는 차이"의 기준: 평균 휘도(Rec. 709) 또는 채널 평균의 차이가 2(0–255 기준)보다 크거나, 채널 차이가 16보다 큰 픽셀이 1%를 넘는 경우다(`run.json`의 `noticeable`).

| 화면 | 평균 휘도 전 → 후 | 채널 평균 차이 RGB | 평균 절대 차이 RGB | 임계값 초과 픽셀 | 판정 |
| --- | --- | --- | --- | --- | --- |
| 00 시작 | 16.234 → 16.234 | 0, 0, 0 | 0, 0, 0 | 0% | 동일 |
| 01 플레이 중 | 16.773 → 16.773 | 0, 0, 0 | 0, 0, 0 | 0% | 동일 |
| 02 게임 오버 | 14.673 → 14.673 | 0, 0, 0 | 0, 0, 0 | 0% | 동일 |

세 화면 쌍이 픽셀 단위로 같다. 기준을 넘는 밝기·색 차이가 없으므로 `docs/game.js`의 렌더링 설정은 바꾸지 않았다.

비교를 공정하게 하려고 넣은 두 가지 조치:

1. 0.187.0은 `MathUtils.generateUUID`에서 `Math.random`을 0.160.0보다 몇 번 더 부른다(시작 화면까지 220회 → 232회, `run.json`의 `threeRandomCalls`). 처음 실행에서는 이 차이로 게임의 시드 난수열이 밀려 플레이 화면이 달라졌다(휘도 차이 −0.117, 픽셀 1.4% 차이). 그래서 비교 페이지는 Three 모듈에서 온 호출을 호출 스택으로 구분해 별도로 센다. 게임의 호출 수는 두 실행에서 같다(`sameRandomSequence: true`).
2. CSS 애니메이션(`.new-record`의 `pulse 1s infinite`, `.toast`)은 가상 프레임 클록이 아니라 실제 시간으로 움직인다. 처음 실행에서는 이 때문에 게임 오버 화면의 HTML 글자만 0.08% 달랐다. 스크린샷은 Playwright `animations: 'disabled'`로 찍는다. WebGL 캔버스에는 영향을 주지 않는다.

## 한계

- 측정은 SwiftShader(CPU) 한 환경에서만 했다. 실제 GPU, 모바일 기기, WebGL2가 없는 브라우저에서는 확인하지 않았다.
- 프레임률·성능은 측정하지 않았다.
