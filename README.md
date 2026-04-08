# Photobook — 흑백 컬러화 + Sweetbook 포토북 주문

## 1. 서비스 소개

**한 문장:** 흑백 사진을 AI로 컬러화한 뒤, [Sweetbook Book Print API](https://api.sweetbook.com/docs/) 워크플로우(판형·템플릿·책 생성 → 사진·표지·내지 → 최종화 → 견적·주문)에 맞춰 웹에서 포토북을 만들고 주문까지 이어 주는 데모 앱입니다.

**타겟:** 조부모·부모 세대의 흑백 사진(가족 앨범, 오래된 인화본, 기념 사진 등)을 더 생생하게 되살려 **가족의 추억을 보존**하고 싶은 사용자와, 이를 실제 주문(인쇄)까지 연결하려는 연동 개발·검증 목적의 사용자(Sandbox 포함)를 함께 가정합니다.

**기능 목록**

- 통합 설정 한 페이지: 판형 선택 → `templateKind`로 **표지(cover)** / **내지(content)** 템플릿 목록 분리 → 책 생성(`bookUid`)
- 컬러화 페이지: 다중 업로드·컬러화 버튼·원본 썸네일·**같은 페이지 하단** 3×3 미리보기(10장↑ 페이징)·재컬러화. 서버 **DeOldify**(Stable/Artistic 가중치), 미설치/오류 시 stub 폴백, **한 장씩** 순차 호출
- Sweetbook: 사진 업로드, 표지·내지(multipart + JSON 파라미터), 최종화, 견적, 주문
- 표지/내지 페이지: `GET /api/templates/{templateUid}` 응답의 `parameters.definitions`를 파싱해 필드 자동 생성(`binding`: `text`·`file`·`rowGallery` 등). 고급 옵션으로 JSON 직접 편집 가능
- Flask 백엔드가 `book/bookprintapi` SDK 경로를 **읽기 전용**으로 참조
- **데모 모드(랜딩 `demo` 버튼)**: Sweetbook API 없이도 설정→주문까지 UI를 확인할 수 있도록 더미 데이터/샘플 이미지를 채워 진행할 수 있습니다. (컬러화는 로컬 백엔드 AI로 실제 실행)
---

## 2. 설치 · 환경 변수 · 실행

### 다른 로컬 환경에서 실행하기(중요)

이 프로젝트는 “내 PC에서만”이 아니라 **다른 개발자의 로컬 환경에서도 그대로 재현**될 수 있도록 아래 전제를 둡니다.

- **폴더 구조 전제**: **프로젝트 루트** 아래에 `photobook-app/`와 `book/`이 함께 있어야 합니다.
  - `photobook-app/backend`는 `book/bookprintapi`를 SDK처럼 `import`해 사용합니다.
- **환경 변수 파일 위치**: 아래 두 위치 중 하나에 `.env`를 두면 됩니다.
  - **프로젝트 루트**의 `.env` (권장: 한 번에 관리)
  - `photobook-app/backend/.env`
- **포트**: 백엔드 `5000`, 프론트 `5173` 기본값입니다. 이미 사용 중이면 다른 프로세스를 종료하거나 포트를 바꿔야 합니다.

### 사전 요구

- Node.js 18+ / npm  
- Python 3.11+ 권장 (3.13에서 검증)  
- **프로젝트 루트**에 `book/bookprintapi` 패키지가 있어야 합니다 (이 저장소 구조 기준).

### 환경 변수

**프로젝트 루트**의 `.env` 또는 `photobook-app/backend/.env`에 둡니다.

- **시작 방법(권장)**: **프로젝트 루트**의 `.env.example`을 복사해 `.env`를 만들고 `BOOKPRINT_API_KEY`만 채우세요.
- **보안**: 실제 키는 절대 커밋하지 마세요. 이 저장소에는 예시만 포함합니다.

```env
BOOKPRINT_API_KEY=SBxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
BOOKPRINT_BASE_URL=https://api-sandbox.sweetbook.com/v1
```

선택:

```env
BOOKPRINT_ENV=sandbox
COLORIZE_MODE=deoldify
COLORIZE_DEFAULT_PROMPT=color photograph, natural colors
```

**DeOldify:** `backend/vendor/DeOldify`에 [thookham/DeOldify](https://github.com/thookham/DeOldify) 소스가 있어야 하고, `pip install -r requirements-deoldify.txt` 로 torch·torchvision·opencv·huggingface-hub 를 설치합니다. 가중치(`ColorizeStable_gen.pth` 등)는 최초 추론 시 `backend/models/deoldify/models/` 로 자동 다운로드됩니다(용량 큼). **stub만 나오면** 의존성·vendor 경로·로그를 확인하세요. `COLORIZE_MODE=stub` 은 경량 전용입니다.

**참고:** Windows에서 `.env`를 UTF-8 BOM으로 저장하면 첫 변수명이 깨질 수 있습니다. BOM 없는 UTF-8이거나, 백엔드가 `utf-8-sig`로 읽도록 이미 처리해 두었습니다.

### 백엔드

```bash
cd photobook-app/backend
py -3 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
pip install -r requirements-deoldify.txt
py app.py
```

기본 주소: `http://127.0.0.1:5000`  
헬스: `GET http://127.0.0.1:5000/api/health`

macOS/Linux 예시:

```bash
cd photobook-app/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install -r requirements-deoldify.txt
python app.py
```

### 프론트엔드

```bash
cd photobook-app/frontend
npm install
npm run dev
```

기본 주소: `http://127.0.0.1:5173` — Vite가 `/api`를 Flask로 프록시하며, 컬러화용 **프록시 타임아웃은 600초**입니다.

### 데모 모드로 바로 확인하기(API 없이)

브라우저에서 `http://127.0.0.1:5173/`로 접속한 뒤, 랜딩에서 아래 중 하나를 눌러 시작합니다.

- **memorize**: 일반 모드(실제 Sweetbook API 연동 흐름)
- **demo**: 데모 모드(더미 데이터로 UI 진행 + 샘플 이미지)

**중요:** 사용자가 URL로 직접 `/book/setup`, `/colorize`, `/order` 등에 접근하는 것을 막기 위해, 이 앱은 **랜딩에서 시작 버튼을 누른 뒤에만** 진행 화면으로 이동할 수 있습니다.

데모 모드에서 사용되는 샘플 흑백 이미지는 프론트 정적 경로에 포함되어 있습니다.

- `photobook-app/frontend/public/demo/bw/bw1.png` ~ `bw4.png`

### 빌드(프론트)

```bash
cd photobook-app/frontend
npm run build
```

---

## 3. 사용 Book Print API (v1)

근거 문서: [전체 워크플로우](https://api.sweetbook.com/docs/guides/workflow/), [API 개요](https://api.sweetbook.com/docs/)

| 앱에서의 단계 | HTTP (Sandbox/Live Base + 경로) | 이 프로젝트에서의 호출 |
|---------------|-----------------------------------|-------------------------|
| 판형 목록 | `GET /v1/book-specs` | `GET /api/book-specs` → SDK `Client.get` |
| 템플릿 목록 | `GET /v1/templates?bookSpecUid=…` | `GET /api/templates` |
| 책 목록 | `GET /v1/Books` | `GET /api/books` (`status`, `limit`, `offset`) |
| 책 생성 | `POST /v1/Books` | `POST /api/books` |
| 책 상세 | `GET /v1/Books/{bookUid}` | `GET /api/books/{bookUid}` (단건 405·404 시 목록으로 폴백) |
| 책 삭제 | `DELETE /v1/Books/{bookUid}` (draft만) | `DELETE /api/books/{bookUid}` |
| 사진 업로드 | `POST /v1/Books/{bookUid}/photos` | `POST /api/books/{bookUid}/photos` |
| 사진 목록 | `GET /v1/Books/{bookUid}/photos` | `GET /api/books/{bookUid}/photos` |
| 표지 조회 | `GET /v1/Books/{bookUid}/cover` | `GET /api/books/{bookUid}/cover` |
| 표지 | `POST /v1/Books/{bookUid}/cover` | `POST /api/books/{bookUid}/cover` (multipart) |
| 내지 | `POST /v1/Books/{bookUid}/contents` | `POST /api/books/{bookUid}/contents` (multipart) |
| 최종화 | `POST /v1/Books/{bookUid}/finalization` | `POST /api/books/{bookUid}/finalization` |
| 견적 | `POST /v1/orders/estimate` | `POST /api/orders/estimate` |
| 주문 | `POST /v1/orders` | `POST /api/orders` |
| 주문 단건 조회 | `GET /v1/orders/{orderUid}` | `GET /api/orders/{orderUid}` |
| 주문 목록 | `GET /v1/orders` | `GET /api/orders` |
| 크레딧 | `GET /v1/credits` | `GET /api/credits` |

**웹훅:** Sweetbook 주문/결제/제작 이벤트를 로컬에서 수신·조회할 수 있도록 최소 기능을 포함합니다.

- `POST /api/webhooks/sweetbook` — Sweetbook webhook 수신(서명 검증)
- `GET /api/webhooks/events` — 수신 이벤트 목록

**로컬 전용:** `POST /api/photos/colorize` — DeOldify, 실패 시 PIL stub. `GET /api/photos/colorize/diagnostics`에 `colorize_backend`(고정 `deoldify`). 이미지 1장씩 처리합니다.

**데모 모드 참고:** 데모 모드에서도 컬러화는 위 로컬 엔드포인트를 실제로 호출해 실행합니다. (다만 Sweetbook 관련 API들은 더미 응답으로 UI를 채웁니다.)

---

## 4. AI 도구 사용 내역 (예시 표)

| 구간 | 도구 / 모델 | 용도 |
|------|-------------|------|
| 컬러화 (기본) | DeOldify (GAN), 모델 싱글톤 캐시 | 흑백 사진 컬러화 |
| 컬러화 (폴백) | Pillow stub | DeOldify 미설치·오류 시 자동 |
| 백엔드 보조 | Cursor / Copilot 등 코딩 어시스턴트 | 스캐폴딩·리팩터 (저장소에 명시 안 함) |

실제 운영 시 사용한 모델 ID·버전은 배포 환경에 맞게 이 표를 갱신하면 됩니다.

---

## 5. 설계 의도 · 비즈니스 관점 · 보완 아이디어

**설계 의도**

- 조부모·부모 세대의 흑백 사진을 “그 시절의 분위기”를 해치지 않으면서 컬러로 되살려, 가족이 함께 보고 **추억을 자연스럽게 공유·보존**할 수 있게 하는 것을 목표로 합니다.
- 컬러화→업로드→표지/내지→주문까지 이어지는 실제 인쇄 워크플로우를 **페이지(라우트)** 로 분리해, 사용자가 “지금 무엇을 하고 있는지”를 잃지 않도록 했습니다.
- 컬러화는 GPU/메모리 피크를 막기 위해 **요청당 1장 + 서버 락**이며, 프론트도 순차 호출합니다(대량 업로드 환경에서 안정성 우선).

**비즈니스**

- “사진을 복원/컬러화해서 간직하고 싶다”는 개인 수요를, **실물 포토북 제작**으로 자연스럽게 이어주는 흐름을 가정합니다. 가족 행사(환갑·칠순, 결혼, 장례/추모 앨범, 돌/백일 등)처럼 기록의 가치가 큰 순간에 특히 유효합니다.

**추가하고 싶은 기능 (예시)**

- 프롬프트로 특정 영역/대상의 색을 지정(예: “어머니 한복은 연분홍, 아버지 넥타이는 남색”)할 수 있도록, **영역 마스크 + 컬러 힌트** 입력 UI 제공
- 손상된 사진(스크래치/구김/노이즈/낡은 인화)을 복원하는 **사진 복원(리스토어)** 파이프라인 추가(업스케일 포함)
- 컬러화·복원 작업 큐(Redis/RQ)와 진행률(WebSocket/Server-Sent Events)

---

## 라우트 요약 (프론트)

| 경로 | 설명 |
|------|------|
| `/book/setup` | 판형 · 템플릿 · 책 생성 |
| `/colorize` | 업로드 · 순차 컬러화 · 동일 페이지 미리보기·재컬러 |
| `/photos/upload` | Sweetbook 사진 업로드 |
| `/cover` | 표지 multipart |
| `/contents` | 내지 삽입(반복 실행 가능) |
| `/order` | 주문 생성 |
| `/manage` | 책/주문 관리(주문·웹훅 목록/조회) |

세션 메타(`bookUid`, 업로드 파일명 등)는 `sessionStorage` 키 `photobook_app_meta_v1`에 저장합니다. 또한 내지 삽입 대기열/성공 항목/성공 카운터는 `bookUid`별 `sessionStorage`에 저장해 **새로고침 후에도** 내지 미리보기/상태 표시가 유지되도록 했습니다. 컬러화 결과 대용량 base64는 메모리에만 두므로 **새로고침 시 유실**될 수 있습니다.

데모 모드는 재현성을 위해 `bookUid`를 `demo-book-1`로 고정해 사용합니다.

