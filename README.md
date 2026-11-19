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
- IR 일정, 확정 상태와 월별 캘린더
- 회차별 방문 날짜·시간·확정, Google 지도 경로 링크
- 회차별 비공개 보고서 업로드와 다운로드 (PDF/HWP/HWPX/DOC/DOCX/XLS/XLSX, 20MB 이하)
- Pseudo User/Admin은 화면 왼쪽 아래에서 전환합니다. 가상 데이터는 현재 브라우저에만 저장되며 실제 Supabase 데이터는 변경하지 않습니다.

## Excel 가져오기 안내

현재 업로드는 암호가 없는 XLSX와 CSV를 지원합니다. 오래된 XLS 파일과 비밀번호가 설정된 Excel을 자동으로 여는 기능은 아직 지원하지 않습니다. 농금원 파일을 열어 암호 보호를 해제하고 XLSX 또는 CSV로 저장한 뒤 올려 주세요. 자동 암호 해제와 XLS 지원은 실제 샘플 파일 형식을 확인한 뒤 추가합니다.

## 자료와 개인정보

초기 자료는 Supabase 데이터베이스에 저장하며 저장소에는 기업 행을 복사하지 않습니다. 사업자등록번호는 요청에 따라 가리지 않습니다. 대표자·담당자 연락처, 이메일, 주소, 내부 메모는 관리자용 private 데이터로 분리합니다. 보고서 파일은 비공개 Storage bucket에 저장하고 허용된 역할만 접근합니다. 비밀번호, 주민등록번호, 계좌/카드 정보는 업로드하지 마세요.

## 인증과 환경설정

Google 로그인은 Supabase Auth Google Provider와 Google Cloud OAuth Web Client 설정이 필요합니다. 앱의 공개 설정은 NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY를 사용합니다. Service Role Key를 브라우저나 저장소에 추가하지 마세요.

## 개발

서버 저장소 위치:

/home/adelie/.authentic_alpha/01_users/01_adelie/01_projects/02_intween_proj/intw-APFS

Node.js 22 이상에서 npm ci 후 npm run dev로 개발 서버를 실행합니다. npm run build는 Vercel 배포 전 프로덕션 빌드 확인에 사용합니다.

## 현재 제한

- 비밀번호 Excel 자동 해제와 XLS 가져오기
- 사업자번호로 주소 자동 검색
- 메일 발송은 메일 앱 작성 링크이며 플랫폼 자체 발송은 연결하지 않았습니다.
- Google 지도 링크를 제공하며 방문 경로 자동 최적화는 아직 없습니다.
- 보고서 본문 자동 변환/요약은 P2 작업입니다.
