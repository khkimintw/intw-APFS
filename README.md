# 농금원 투자 전 지원사업 업무 플랫폼

농금원 투자 전 지원사업의 경영체, 컨설턴트 배정, 상담 회차와 보고 상태를 관리하는 인트윈 내부 플랫폼입니다. 화면은 React + JavaScript/JSX 기반 Next.js로 작성했습니다.

## 현재 상태

- Supabase 프로젝트 `intw-APFS`에 기본 업무 스키마와 Row Level Security(RLS)를 적용했습니다.
- 농금원 관리 시트 `1. 경영체 리스트 풀&특이사항(진행중)`에서 235개 행을 `companies`에 초기 자료로 적재했습니다. 원본 행은 공개 GitHub 저장소에 포함하지 않았습니다.
- 로그인/가입 화면, 가입 승인 대기, 경영체 조회, 관리자·host의 경영체 CRUD, 회차 CRUD, 사용자 역할·배정 관리 UI를 연결했습니다.
- Google 로그인 버튼은 구현했습니다. Google OAuth는 Supabase Auth의 Google 공급자 Client ID/Secret 설정과 Redirect URL 등록을 마쳐야 작동합니다. 이메일/비밀번호 가입도 제공됩니다.
- 매니저 계정은 `khkim.intw@gmail.com`으로 최초 가입해야 `host`가 됩니다. 다른 계정은 기본 `user`·경영체 유형·승인 대기로 만들어집니다.
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
- `lib/supabase.js`에는 URL과 publishable key fallback이 있습니다. 필요하면 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`로 덮어쓸 수 있습니다.
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
