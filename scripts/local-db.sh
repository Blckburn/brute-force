#!/usr/bin/env bash
# Локальный Postgres для проверки срезов и для тестов.
#
# Нужен потому, что до Neon из среды разработки может не быть сети
# (политика egress). Схема и миграции применяются те же самые, что
# потом лягут на Neon, — проверка настоящая, а не на моках.
#
#   bash scripts/local-db.sh up     — поднять и создать базу
#   bash scripts/local-db.sh down   — остановить
#   bash scripts/local-db.sh psql   — консоль
#   bash scripts/local-db.sh url    — напечатать DATABASE_URL
#
# Postgres отказывается работать от root, поэтому под root скрипт
# переключается на непривилегированного пользователя ($LOCAL_PG_USER).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGDATA="$ROOT/.localdb/data"
SOCKET_DIR="$ROOT/.localdb/socket"
LOGFILE="$ROOT/.localdb/postgres.log"
DBNAME="${LOCAL_PG_DB:-bruteforce}"
PORT="${LOCAL_PG_PORT:-55432}"
RUN_AS="${LOCAL_PG_USER:-ubuntu}"

# Выполнить команду от имени владельца кластера.
as_pg_user() {
  if [ "$(id -u)" -eq 0 ]; then
    su "$RUN_AS" -s /bin/bash -c "$1"
  else
    bash -c "$1"
  fi
}

url() {
  echo "postgres://postgres@127.0.0.1:$PORT/$DBNAME"
}

prepare_dirs() {
  mkdir -p "$SOCKET_DIR" "$(dirname "$PGDATA")"
  touch "$LOGFILE"
  if [ "$(id -u)" -eq 0 ]; then
    chown -R "$RUN_AS" "$ROOT/.localdb"
  fi
}

is_running() {
  as_pg_user "'$PGBIN/pg_ctl' -D '$PGDATA' status" >/dev/null 2>&1
}

up() {
  prepare_dirs

  if [ ! -s "$PGDATA/PG_VERSION" ]; then
    echo "инициализирую кластер в $PGDATA"
    as_pg_user "'$PGBIN/initdb' -D '$PGDATA' -U postgres --auth=trust --encoding=UTF8" >/dev/null
  fi

  if is_running; then
    echo "postgres уже запущен"
  else
    as_pg_user "'$PGBIN/pg_ctl' -D '$PGDATA' -l '$LOGFILE' -o '-p $PORT -k $SOCKET_DIR -c listen_addresses=127.0.0.1' -w start" >/dev/null
    echo "postgres запущен на порту $PORT"
  fi

  if ! psql "postgres://postgres@127.0.0.1:$PORT/postgres" -tAc \
    "select 1 from pg_database where datname = '$DBNAME'" | grep -q 1; then
    psql "postgres://postgres@127.0.0.1:$PORT/postgres" -qc "create database \"$DBNAME\""
    echo "база $DBNAME создана"
  fi

  echo "DATABASE_URL=$(url)"
}

down() {
  if is_running; then
    as_pg_user "'$PGBIN/pg_ctl' -D '$PGDATA' -w stop" >/dev/null
    echo "postgres остановлен"
  else
    echo "postgres не запущен"
  fi
}

case "${1:-up}" in
  up) up ;;
  down) down ;;
  url) url ;;
  psql) exec psql "$(url)" ;;
  *)
    echo "использование: $0 {up|down|psql|url}" >&2
    exit 1
    ;;
esac
