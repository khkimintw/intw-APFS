# 농금원 투자 전 지원사업 업무 플랫폼

농금원 지원사업의 경영체, 담당자, 상담 회차, IR 일정과 보고서를 관리하는 인트윈 내부 업무 플랫폼입니다. React와 JavaScript/JSX를 사용합니다.

## 주소와 저장소

- Vercel Production: https://intw-apfs-git-main-intween-temp.vercel.app/
- Vercel 연결 저장소: khkimintw/intw-APFS
- 백업 저장소: intween/intw-APFS
- Supabase 프로젝트: crxdsuwutniahwfmmyxf (Seoul)
- main으로 push하면 Vercel 배포가 시작됩니다. Vercel 접근 보호가 켜져 있으면 로그인해야 합니다.

## 역할

| 역할 | 권한 |
| --- | --- |
| host | 전체 자료, 사용자 승인·역할 설정, 경영체와 회차 관리 |
| admin | 전체 경영체와 회차 관리, 사용자 권한 설정 |
| consultant | 배정받은 경영체와 상담 회차 관리 |
| client | 계정에 연결된 본인 경영체 조회 |

확인된 Google 계정으로 가입한 @intw.co.kr 사용자는 자동으로 admin 승인을 받습니다. host/admin은 계정 및 권한 화면에서 다른 계정을 관리합니다.

## 주요 기능

- 경영체 검색, 상태/포기/재도전/IR 필터와 페이지당 10·20·30·40·50·전체 표시
- XLSX 내보내기와 현재 필터 결과의 행 범위 지정
- Excel/CSV 업로드 미리보기, 중복·오류 안내, 파일별 등록자·시각·결과 이력, 안전 조건이 맞는 업로드 되돌리기
- 상세 화면의 원본 시트 항목, 특이사항, 인트윈 확인사항, 담당자/대표자 정보와 주소 확인 상태
- 사업자번호/경영체명으로 기존 데이터의 주소를 재사용하고, 우편번호 주소 검색으로 표준 주소를 선택한 뒤 확인 필요 상태로 저장
- 플랫폼 이메일 발송, 재발송 횟수/시각/본문/받는 사람 이력, 가능한 경우 기존 메일 대화(thread) 연결
- IR 일정, 확정 상태와 월별 캘린더
- 회차별 방문 날짜·시간·확정, Google 지도 경로 링크
- 회차별 비공개 보고서 업로드와 다운로드 (PDF/HWP/HWPX/DOC/DOCX/XLS/XLSX, 20MB 이하)
- Pseudo User/Admin은 화면 왼쪽 아래에서 전환합니다. 가상 데이터 변경은 현재 브라우저에만 저장됩니다. Pseudo Admin의 이메일 테스트는 실제 메일을 보내며, 기본 설정에서는 GIA·IIA 테스트 주소로만 발송됩니다.

## Excel 가져오기 안내

업로드는 XLS, XLSX, CSV를 지원하고 파일 열기 암호 2026을 자동으로 시도합니다. 시트 편집 보호만 걸린 파일은 읽을 수 있습니다. XLS의 일부 구형 암호 방식도 지원합니다. Excel AES로 암호화한 XLSX는 사용 중인 무료 파서에서 복호화할 수 없으므로 Excel에서 파일을 열어 암호 보호를 해제한 뒤 다시 저장해야 합니다. 농금원 샘플이 없어 정확한 주간 파일 암호화 방식은 확인하지 못했습니다.

## 자료와 개인정보

초기 자료는 Supabase 데이터베이스에 저장하며 저장소에는 기업 행을 복사하지 않습니다. 사업자등록번호는 요청에 따라 가리지 않습니다. 대표자·담당자 연락처, 이메일, 주소, 내부 메모는 관리자용 private 데이터로 분리합니다. 보고서 파일은 비공개 Storage bucket에 저장하고 허용된 역할만 접근합니다. 비밀번호, 주민등록번호, 계좌/카드 정보는 업로드하지 마세요.

## 인증과 환경설정

Google 로그인은 Supabase Auth Google Provider와 Google Cloud OAuth Web Client 설정이 필요합니다. 앱의 공개 설정은 NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY를 사용합니다. Service Role Key를 브라우저나 저장소에 추가하지 마세요.

플랫폼 메일은 Vercel Production 환경에 서버 전용 `RESEND_API_KEY`와 `P1_EMAIL_FROM`을 설정해야 실제 발송됩니다. Pseudo 테스트 메일의 추가 허용 수신 주소는 선택 환경변수 `P1_PSEUDO_TEST_RECIPIENTS`에 쉼표로 지정할 수 있습니다. 기본값은 `khkim.intw@gmail.com,kh.kim@intw.co.kr`입니다. Resend에서 발신 도메인을 인증한 뒤 `P1_EMAIL_FROM`을 `농금원 업무 플랫폼 <p1@인증된도메인>` 형식으로 지정하고 재배포하세요. 이 값은 `NEXT_PUBLIC_` 접두사를 붙이면 안 되며 Git에 넣지 마세요. 회신 주소는 서버 전용 `P1_EMAIL_REPLY_TO`(기본값 `sasurae@intw.co.kr`)로 지정하며 Resend `reply_to`로 전달되고, 발송 본문 하단에 회신 안내 문구가 자동 추가됩니다. 발송이 확인되면 발송자(및 같은 이메일의 승인된 사이트 계정)에게 앱 내 알림(상단 종 아이콘)이 생성됩니다. 이를 위해 `supabase/migrations/20261119050000_p1_notifications.sql` 적용이 필요합니다. 메일 이벤트의 외부 전달/열람 추적은 현재 제공하지 않습니다. 앱에서는 발송 요청 접수/실패, 발송 번호, 시간, 본문을 보관합니다. Resend가 Message-ID를 반환한 경우 다음 메일은 `In-Reply-To`/`References` 헤더를 사용해 같은 대화로 연결합니다.

## 개발

서버 저장소 위치:

/home/adelie/.authentic_alpha/01_users/01_adelie/01_projects/02_intween_proj/intw-APFS

Node.js 22 이상에서 npm ci 후 npm run dev로 개발 서버를 실행합니다. npm run build는 Vercel 배포 전 프로덕션 빌드 확인에 사용합니다.

## 현재 제한

- AES 방식으로 파일 자체를 암호화한 XLSX 자동 해제
- 국세청 사업자등록정보 API는 주소를 찾아 돌려주는 검색 API가 아니라 입력한 주소 등의 진위 여부를 확인하는 API입니다. 따라서 현재 주소 자동 채움은 기존에 등록된 같은 사업자번호/경영체 자료를 재사용하고, 새 주소는 우편번호 서비스에서 선택한 뒤 확인 필요로 표시합니다. 사업자번호만으로 외부 사업장 주소를 검색하려면 별도의 주소 데이터 공급자와 API 계약/키가 필요합니다.
- 실제 메일 발송은 Resend API 키와 인증된 발신 도메인을 Production 환경에 설정해야 활성화됩니다.
- Google 지도 링크를 제공하며 방문 경로 자동 최적화는 아직 없습니다.
- 보고서 본문 자동 변환/요약은 P2 작업입니다.
