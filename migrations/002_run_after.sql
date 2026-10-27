-- 사용 한도에 걸린 작업을 일정 시간 뒤에 다시 꺼내도록 실행 가능 시각을 둔다
ALTER TABLE jobs ADD COLUMN run_after timestamptz;
