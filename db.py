import os, psycopg2, psycopg2.extras
from psycopg2 import pool
from contextlib import contextmanager

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://kimfam:Kanyoga%401234@localhost/kimfamhub")

_pool = pool.ThreadedConnectionPool(2, 10, DATABASE_URL)

def get_conn():
    """A live connection. The server (or a network device) drops idle SSL connections, and the pool would hand one out
    dead: the next request then failed with 'SSL connection has been closed unexpectedly' (500 on 10 Oct 2026). Each
    connection is pinged before use; a dead one is discarded and replaced."""
    for _ in range(_pool.maxconn + 1):
        conn = _pool.getconn()
        try:
            if conn.closed:
                raise psycopg2.InterfaceError("closed")
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
            conn.rollback()
            return conn
        except Exception:
            try:
                _pool.putconn(conn, close=True)
            except Exception:
                pass
    return _pool.getconn()

def release_conn(conn):
    _pool.putconn(conn)

@contextmanager
def db():
    conn = get_conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        release_conn(conn)

def query(sql, params=None):
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            return cur.fetchall()
    finally:
        release_conn(conn)

def execute(sql, params=None):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            result = cur.fetchone() if cur.description else None
        conn.commit()
        return result
    except Exception:
        conn.rollback()
        raise
    finally:
        release_conn(conn)



def execute_returning(sql, params=None):
    """Run a write that has RETURNING and COMMIT it; -> list of rows. (query() never commits: a write through it is
    silently rolled back, which hid two bugs in October 2026.)"""
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            rows = cur.fetchall() if cur.description else []
        conn.commit()
        return rows
    except Exception:
        conn.rollback()
        raise
    finally:
        release_conn(conn)
