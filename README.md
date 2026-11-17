# 농금원 투자 전 지원사업 업무 플랫폼

농금원 투자 전 지원사업의 경영체, 컨설턴트 배정, 상담 회차와 보고 상태를 관리하는 인트윈 내부 플랫폼입니다. 화면은 React + JavaScript/JSX 기반 Next.js로 작성했습니다.

## 기존 운영 상태와 현재 로컬 변경

- Supabase 프로젝트 `intw-APFS`에 기본 업무 스키마와 Row Level Security(RLS)를 적용했습니다.
- 농금원 관리 시트 `1. 경영체 리스트 풀&특이사항(진행중)`에서 235개 행을 `companies`에 초기 자료로 적재했습니다. 원본 행은 공개 GitHub 저장소에 포함하지 않았습니다.
- 로그인/가입·승인 대기와 경영체/회차/사용자 관리 UI가 있습니다. 이번 로컬 변경은 업무 CRUD를 `/api/v1` 서버 검증으로 전환했으며 아직 배포하지 않았습니다.
- Google 로그인 버튼은 구현했습니다. Google OAuth는 Supabase Auth의 Google 공급자 Client ID/Secret 설정과 Redirect URL 등록을 마쳐야 작동합니다. 이메일/비밀번호 가입도 제공됩니다.
- 최초 host 대상은 `khkim.intw@gmail.com`입니다. 새 hardening 초안은 이메일 문자열만으로 자동 승격하지 않습니다. 이메일 인증 뒤 Auth 콘솔에서 UUID와 계정 소유자를 대조해 최초 host를 지정합니다. 운영 프로필은 이번 조사 시 0개였습니다. 다른 계정은 기본 `user`·경영체 유형·승인 대기입니다.
- Vercel Production 사이트: [intw-apfs](https://intw-apfs-git-main-intween-temp.vercel.app/). 배포 보호가 켜져 있으면 Vercel 계정 로그인이 필요합니다.
- alphagpu 내부 주소: [APFS (tailnet)](https://alphagpu.tail98287a.ts.net:8443). Tailscale tailnet 안에서만 접근됩니다.

## 역할 및 승인 흐름

| 역할 | 접근 범위 |
| --- | --- |
| `host` | 서비스 소유자. 전체 자료, 사용자 승인·권한 변경, 경영체 CRUD |
| `admin` | 전체 업무자료와 사용자 권한을 관리. host 권한으로 승격할 수 없음 |
| `user` + `consultant` | 본인에게 배정된 경영체와 회차 기록 |
| `user` + `client` | 프로필에 연결된 본인 경영체 조회 |

가입하면 프로필은 `approved=false` 상태이며, 승인 전에는 업무 화면으로 진입하지 않습니다. host/admin이 승인하고 역할과 사용자 유형을 설정한 뒤 접근이 열립니다. 계정 비활성화는 별도로 관리합니다. Supabase RLS가 화면의 버튼 표시와 별개로 데이터 범위를 강제합니다.

## Supabase 설정

- APFS 전용 project ref: `crxdsuwutniahwfmmyxf` (Seoul)
- URL: `https://crxdsuwutniahwfmmyxf.supabase.co`
- 브라우저에는 공개 가능한 publishable key만 사용합니다. Service Role Key를 코드·브라우저·Vercel 환경변수에 넣지 마세요.
- `lib/public-config.js`에는 URL과 공개 publishable key fallback이 있고 `lib/supabase.js`는 인증 클라이언트를 만듭니다. 필요하면 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`로 덮어쓸 수 있습니다.
- 로그인 설정: Supabase Auth Site URL을 `https://intw-apfs-git-main-intween-temp.vercel.app`로 지정하고 이 주소 및 `https://alphagpu.tail98287a.ts.net:8443`를 Redirect URLs에 추가하세요. Google Cloud OAuth의 승인된 redirect URI는 `https://crxdsuwutniahwfmmyxf.supabase.co/auth/v1/callback`이며, Google 공급자 활성화에 필요한 Client ID/Secret은 Supabase Auth 설정 화면에 직접 입력합니다.
- RLS 정책과 private helper 함수는 migration으로 적용했습니다. 공개 저장소에 사용자 데이터·비밀 키를 커밋하지 않습니다.

## 개발

Node.js 22 이상과 npm을 사용합니다.

```bash
cd /home/adelie/.authentic_alpha/01_users/01_adelie/01_projects/02_intween_proj/intw-APFS
npm ci
npm run dev
```

Production build:

```bash
npm run build
npm run start
```

## 자료 및 개인정보

초기 자료 235개는 사용자가 합성 더미 자료라고 확인한 시트 행입니다. Supabase 전용 DB에만 저장하고, GitHub의 소스·README·스크린샷에는 행이나 연락처를 복사하지 않습니다. 운영에 실제 자료를 넣기 전 공개 범위와 권한 설정을 다시 확인하세요.

## 저장소와 배포

- Vercel 연결 저장소: [khkimintw/intw-APFS](https://github.com/khkimintw/intw-APFS)
- 백업 저장소: [intween/intw-APFS](https://github.com/intween/intw-APFS)
- push 시 Vercel `main` Production 배포가 실행됩니다.
- Supabase는 APFS 전용 프로젝트만 사용합니다. AX와 프로젝트 데이터/환경변수를 공유하지 않습니다.

## 아직 필요한 외부 설정

1. Supabase Auth에서 Google OAuth 공급자를 설정하고 Client ID/Secret, Site URL, Redirect URLs를 지정합니다.
2. host 계정 `khkim.intw@gmail.com`으로 Google 또는 이메일 가입 후 첫 관리자 화면을 확인합니다.
3. 새 사용자가 가입하면 host/admin이 승인하고 `user`/`admin`, 컨설턴트/경영체 유형 및 경영체 배정을 지정합니다.
4. Figma 원본 화면은 현재 Figma 연동에서 보기 권한으로도 가져오지 못했습니다. 연결 도구가 편집 권한을 요구하므로 정확한 디자인 일치는 파일에 편집 권한이 필요합니다.


## 2026-11-17 P1 로컬 MVP 완료 범위

조사와 단계별 결과는 [PROGRESS.md](PROGRESS.md), 서버 계약은 [API-CONTRACT.md](docs/API-CONTRACT.md), 버전 경로·요청 스키마는 [OpenAPI](docs/openapi.json)에 기록했습니다. 기존 235개 기업과 156개 상담은 읽기 전용 개수만 확인했고 행을 수정·삭제하지 않았습니다. 기존 원격·기본 스키마·운영 서비스·Tailscale 설정도 유지했습니다.

- 회사 검색/테마·상태·IR 태그 필터, 배정, 회사 CRUD와 회차 일정/비대면/보고상태/업무메모 CRUD는 실제 Supabase 요청용 서버 API를 사용합니다. mock/demo 경로와 가짜 응답은 제공하지 않습니다.
- 서버는 사용자 JWT를 Auth `getUser`로 검증하고 승인·활성·역할·회사 범위를 검사한 뒤 동일 JWT/RLS로 조회합니다. role은 host/admin/user, user kind는 consultant/client입니다. client는 자기 회사 조회만, consultant는 배정 회사의 회차 작성, host/admin은 전체 회사·회차 CRUD/승인·권한 관리를 수행합니다. host 지정은 host만 가능합니다.
- 회사에 상담 이력이 있으면 삭제를 차단합니다. 회차는 upsert로 덮어쓰지 않고 중복을 거부합니다. 신규 진단 1회/컨설팅 최대 3회를 적용하며 기존 4회차는 유지·수정할 수 있습니다.
- 개인이메일·연락처·주소·주민번호·생년월일·원문 payload·관리자 notes는 앱 응답/화면에 포함하지 않습니다. 로그인 이메일은 인증에만 사용합니다. 업무 메모에도 개인정보를 쓰지 마세요.
- KPI·감사 목록·사용자 관리는 관리자 전용입니다. 새 출발거점 컬럼과 보고서 파일 Storage는 아직 적용하지 않아 비활성입니다. 지도·AI·사업자조회·변환·정산은 연결하지 않았습니다.
- OAuth는 현재 Google 비활성으로 확인했습니다. 이메일은 활성이고 이메일 확인이 필요합니다. Google Client ID/Secret과 Redirect URL을 콘솔에서 설정한 다음 `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`를 지정해야 버튼이 활성화됩니다. 비밀값을 `.env.example`·Git·브라우저에 넣지 않습니다.

### 검증 결과와 한계

`npm run build`가 성공했습니다. `npm run test:rls`는 실제 PostgreSQL 엔진(PGlite) 안에 합성 Auth/역할/행과 기존 스키마·새 hardening 초안을 구성해 22/22 통과했습니다. pending/inactive 차단, 배정/자기회사 범위, host 보호, admin CRUD, 직접 SQL 개인정보 컬럼 우회 차단, 감사 위조 방지, 중복·신규 회차 제한과 기존 4회차 보존을 확인합니다. 실제 업무 자료와 운영 계정은 fixture로 사용하지 않습니다.

```bash
npm ci
npm run test:rls
npm run build
npm run dev
```

개발 서버는 127.0.0.1:3001에만 바인딩합니다. 기존 서비스가 사용 중이면 해당 서비스를 중지하지 말고 Next CLI에서 별도 로컬 포트를 지정하세요. 로컬 Production은 빌드 후 `npm run start`입니다.

운영 profiles가 0개여서 실제 비밀번호 로그인→host 승인→여러 실제 JWT의 CRUD/RLS 흐름은 아직 수행하지 않았습니다. 이메일/Google 설정 확인과 로컬 합성 역할 검증을 운영 로그인 검증 완료라고 표시하지 않습니다. 브라우저 렌더링·한컴 문서 처리는 이번 P1 검증 범위가 아닙니다.

### 운영 적용의 마지막 단계

[hardening SQL](supabase/drafts/20261117_api_rls_hardening.sql)과 [영향·초기 host·롤백](supabase/drafts/20261117_api_rls_hardening_ROLLBACK.md)을 먼저 검토하세요. **SQL은 아직 운영에 적용하지 않았습니다.** 현재 배포의 `select *`는 새 컬럼 권한 축소와 호환되지 않으므로 새 API/UI 배포와 동시 전환해야 합니다. 새 API의 필드 제한만으로 기존 DB의 모든 직접 접근이 이미 막혔다고 주장하지 않습니다.

최종 순서는 계정·프로젝트 확인 → 기존 DB 복원 지점 확보 → 이메일 확인된 khkim UUID 대조/최초 host 지정 → 새 API/UI와 hardening 동시 전환 → 승인된 합성 계정으로 운영 JWT/RLS 실증입니다. 기존 235/156 행 삭제나 재적재는 필요하지 않습니다. 실패 시 쓰기를 중지하고 버전/정책 스냅샷으로 복구하며, DB 전체 삭제·reset은 하지 않습니다.

Vercel은 기존 intw-apfs 프로젝트와 main 연결을 유지합니다. 이번 로컬 변경은 push하지 않았으며 새 배포가 아닙니다. 공개 범위·접근 보호·Hobby 한도와 롤백을 확인하고 배포 직전 승인을 받아야 합니다. 새 무료 프로젝트 생성·요금제 변경·유료 add-on·Funnel 공개는 하지 않습니다. Service role key는 서버에도 필요하지 않습니다.
