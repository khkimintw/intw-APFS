# 농금원 투자 전 지원사업 워크플로우

농금원 투자 전 지원사업을 운영하는 인트윈 관리자와 컨설턴트를 위한 내부 웹 도구입니다. 경영체는 직접 로그인하지 않으며 관리자가 계정을 발급합니다.

## 현재 상태

- React + JavaScript/JSX 기반 Next.js 합성 UI MVP를 작성했습니다. alphagpu에서 `npm ci`와 `npm run build`가 성공했습니다. 테스트·린트·브라우저 검증은 실행하지 않았습니다.
- Vercel `main` 자동 Production 배포가 성공했습니다. 해당 앱은 합성 데이터 데모이며 실제 업무 인증·DB 저장은 미구현입니다.
- 앱은 화면 내 상태만 사용하며 새로고침하면 초기화됩니다. 실제 업무 데이터를 입력하지 마세요.
- 기존 업무 자료에는 기업·담당자 개인정보가 포함될 수 있으므로 저장소에 복사하지 않습니다.
- Supabase 프로젝트는 준비되어 있습니다. Vercel Hobby 팀의 `intw-apfs` 프로젝트는 `khkimintw/intw-APFS`에 연결되어 있습니다. 앱 코드는 Public GitHub 저장소에 push됐고 Vercel Production 배포가 성공했습니다. 서비스 주소는 [https://intw-apfs-git-main-intween-temp.vercel.app/](https://intw-apfs-git-main-intween-temp.vercel.app/)이며 Vercel Authentication으로 보호됩니다.

## 업무 흐름

1. 관리자가 주간 Excel 자료를 업로드하고 기업을 등록합니다. 중복과 IR 직행 구분을 확인합니다.
2. 사업자번호 기반 주소 후보를 검토하고 주소를 확정합니다.
3. 승인된 분석 공급자 또는 분명히 표시된 목업으로 1차 분석을 진행합니다.
4. 관리자가 컨설턴트를 배정하고 일정 및 방문 순서를 관리합니다.
5. 컨설턴트가 담당 기업의 회차별 컨설팅 기록과 보고서를 관리합니다.
6. 관리자가 보고서 제출을 확인하고 IR 선발 및 투자사 검토 의견을 정리합니다.
7. 관리자가 농금원 보고와 정산 현황을 관리합니다.

## 역할과 접근 범위

- **관리자:** 전체 기업, 배정, 제출 현황, KPI, 투자사 의견, 정산을 관리합니다.
- **컨설턴트:** 자신에게 배정된 기업과 방문 일정, 관련 자료만 확인하고 보고서를 제출합니다.
- 기업·컨설팅 상태 변경과 파일 업로드는 이력으로 남깁니다.
- 컨설턴트에게 관리자 전용 메모·정산·지급 정보가 API, 화면, 내보내기를 통해 노출되지 않도록 서버 권한 검사와 Supabase RLS를 함께 적용합니다.

## 제품 원칙

- 개인정보, 사업자번호, 연락처, IR 원본, 정산 행을 Git 저장소·테스트 fixture·로그에 넣지 않습니다. 예시는 합성 데이터만 씁니다.
- Google Sheets는 사전 승인 전까지 탭/헤더 구조만 확인하고 실제 행을 읽거나 쓰지 않습니다.
- 외부 사업자 조회, 지도, AI 분석 공급자 연동은 API 명세·비용·약관·권한을 확인한 뒤 진행합니다.
- 주소 후보와 방문 순서는 관리자가 확인·수정할 수 있게 합니다. 확인되지 않은 도로 최적화나 AI 분석을 완료된 기능처럼 표시하지 않습니다.

## 기술 및 실행 방법

프런트엔드는 React와 JavaScript/JSX로 구현합니다. 화면은 React 컴포넌트로 구성하고 TypeScript (`.ts`, `.tsx`)는 사용하지 않습니다. Vercel framework가 필요한 경우 Next.js의 JavaScript 구조를 사용합니다.

### 로컬 개발 명령 (이번 작업에서는 실행하지 않음)

Node.js 22 이상과 npm을 사용합니다. Next.js/React 버전은 package.json에 고정했습니다. 현재 의존성 설치·개발 서버·린트·빌드·테스트·브라우저 확인은 실행하지 않았습니다.

```bash
cd /home/adelie/.authentic_alpha/01_users/01_adelie/01_projects/02_intween_proj/intw-APFS
npm install
npm run dev
```

개발 서버는 `127.0.0.1:3001`에만 바인딩합니다. 서버와 다른 기기에서 접근하려면 승인된 비공개 접근 방식을 별도로 준비해야 합니다. Funnel이나 외부 바인딩은 설정하지 않습니다. 환경변수 없이 합성 UI를 사용할 수 있습니다. `.env.example`은 향후 별도 Supabase 프로젝트의 변수 이름·설명만 담고 있으며 앱에서 사용하지 않습니다.

현재 `npm run build`는 alphagpu에서 성공했습니다. 코드 변경 후 배포 전 빌드 결과를 갱신하세요. 테스트·린트 도구와 관련 scripts는 추가하지 않았습니다. 로컬 Production 실행 명령은 `npm run start`입니다.

### 현재 구현 범위와 한계

관리자/합성 컨설턴트 화면, 담당 기업 필터, 컨설턴트 배정 변경, IR 직행 태그 필터, 합성 업로드 회차 중복 검토, 회차 등록/제외 시연, 방문 가능일·합성 출발지 입력, 보고 제출 상태 시연을 제공합니다. 중복 기준은 합성 기업 ID+상담 유형+회차입니다. 등록 후 같은 회차 후보는 차단됩니다. 관리자 KPI는 합성 보고 제출 건수이며 월 30건은 목표값만 표시합니다. IR 직행 태그를 선발 실적으로 세지 않습니다. 컨설턴트 화면에는 KPI·정산·전체 기업을 표시하지 않지만 역할 전환은 인증·보안 통제가 아닙니다. 단가·정산 금액·연락처는 코드에 넣지 않았습니다.

- `app/`: 한국어 루트 레이아웃·페이지·반응형 스타일.
- `components/`: 화면과 접근성 레이블을 포함한 공통 UI 컴포넌트.
- `modules/demo.js`: 이 제품만의 합성 데이터. 다른 저장소와 데이터·환경변수를 공유하지 않습니다.
- 인증·서버 API·Supabase SDK/DB/Storage/RLS·파일 업로드/파싱·외부 AI/API·문서 변환/다운로드·영구 저장은 미구현입니다. 브라우저 저장소에도 저장하지 않습니다.
- Google Sheets·지도·사업자번호 조회·정산 등 외부 업무 연동은 없으며 승인받지 않은 외부 쓰기를 제공하지 않습니다.
- 키·개인정보·내부 자료를 입력하거나 저장소에 복사하지 마세요. 검색엔진 noindex 메타데이터는 접근 통제가 아닙니다.


## 저장소와 배포

- Vercel 배포 저장소: [khkimintw/intw-APFS](https://github.com/khkimintw/intw-APFS) (현재 Public)
- 백업 저장소: [intween/intw-APFS](https://github.com/intween/intw-APFS)
- Supabase project ref: `crxdsuwutniahwfmmyxf` (서울 리전)
- Vercel 프로젝트: [intw-apfs 대시보드](https://vercel.com/intween-temp/intw-apfs), Hobby (`intween_temp` 팀). Git 연결 완료, 기본 브랜치는 `main`입니다.
- 서버 저장소의 `origin`은 fetch를 `intween/intw-APFS`에서 하고 `git push origin`은 `khkimintw/intw-APFS`와 `intween/intw-APFS` 모두에 보냅니다. 두 저장소의 브랜치 tip을 맞춰 유지하세요.
- React 앱 scaffold의 Vercel Production 배포가 성공했습니다. 접속 주소는 [https://intw-apfs-git-main-intween-temp.vercel.app/](https://intw-apfs-git-main-intween-temp.vercel.app/)이며 Vercel Authentication 로그인이 필요합니다.
- 배포용 GitHub 저장소가 Public이므로 개인정보, IR 원문, 정산 정보, 비밀값, 실제 고객 자료는 커밋하지 않습니다.

## 개발 참여

작업 전 `PLAN.md`, `AGENTS.md`, 현재 브랜치와 변경사항을 확인하세요. 개인정보나 원문 업무 자료를 추가하지 말고, 검토 가능한 작은 변경 단위로 작업합니다. 빌드·린트 명령은 프로젝트 설정이 만들어진 뒤 이 README에 명시합니다.


## 배포 상태 · Vercel Production 배포 완료

- 저장소 루트의 `vercel.json`에서 framework `nextjs`, Build Command `npm run build`, Output Directory `.next`를 명시해 Vercel 프로젝트의 기존 `public` 출력 폴더 설정을 덮어씁니다.
- Vercel Production 주소: [https://intw-apfs-git-main-intween-temp.vercel.app/](https://intw-apfs-git-main-intween-temp.vercel.app/). HTTP 요청은 Vercel 로그인으로 이동하므로 Vercel Authentication 보호가 적용된 상태입니다. 접근 권한이 있는 Vercel 팀 사용자로 로그인해야 합니다.
- 이전 실패 배포 로그: [Vercel 배포 로그](https://vercel.com/intween-temp/intw-apfs/8gpbgsoawyyEwrHAUcWXzAUBfQBb)에서 확인할 수 있습니다. 당시 Next.js 빌드는 성공했으나 출력 디렉터리를 `public`으로 찾던 설정이 원인이었습니다.
- 배포된 앱은 Vercel Authentication으로 보호됩니다. `intw-ax.vercel.app`/`intw-apfs.vercel.app` 기본 별칭은 설정되지 않았고, 위의 `git-main` 주소를 사용합니다. alphagpu의 직접 공개 URL은 아직 없습니다.
- Hobby 내부 비상업 범위와 무료 한도, 저장소/production branch `main`, 환경변수 적용 범위, 접근 통제·공개 범위 및 롤백 절차를 확인하고 외부 공개 직전 사용자 승인을 받습니다. 유료 전환/애드온을 사용하지 않습니다.
- Supabase는 기존 프로젝트를 유지합니다. 현재 DB 연결·migration은 없으며 실제 연동 전 서버 인증/인가·RLS·private Storage를 설계하고 별도 승인받아야 합니다.
- 현재 앱과 README는 `khkimintw` 배포 저장소와 `intween` 백업 저장소 양쪽 `main`에 push됐습니다. Vercel Production 배포는 성공했습니다. alphagpu 외부 공개 설정은 하지 않았습니다.
- `npm ci`와 `npm run build`는 alphagpu에서 성공했고, Vercel Production 배포도 성공했습니다. 테스트·린트·개발 서버·브라우저에서 로그인 후 화면 확인·`git diff --check`는 실행하지 않았습니다. 실제 업무 인증과 Supabase 연동은 없습니다.
