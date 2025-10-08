import sqlite3
import json
from contextlib import contextmanager
from tables import Tables
from fastapi import FastAPI
from update_indexes import UpdateIndexes, UpdateIndexesRequest
from contextlib import asynccontextmanager

DB_NAME = "database.db"

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield
    print("Shutting down...")
    
app = FastAPI(lifespan=lifespan)

@contextmanager
def get_db_connection():
    """
    Context manager for database connections.
    Ensures connection to database, and will create
    the database file if it doesn't exist.
    """
    conn = sqlite3.connect(DB_NAME)
    try:
        yield conn
    finally:
        conn.close()


# Database setup

def init_db():
    with get_db_connection() as conn:
        cursor = conn.cursor()
        tables = Tables.define_tables()
        # Drop everything, at start   # Drop old table if it exists
        # cursor.execute("DROP TABLE IF EXISTS projects")
        # cursor.execute("DROP TABLE IF EXISTS documents")
        # cursor.execute("DROP TABLE IF EXISTS classes")
        # cursor.execute("DROP TABLE IF EXISTS methods")
        # cursor.execute("DROP TABLE IF EXISTS method_calls")
        print("Creating tables...")
        for table in tables:
            cursor.execute(table)

        conn.commit()


def fetch_from_table(table_name, query=None):
    try:
        with get_db_connection() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            if query is None:
                query = f"SELECT * FROM {table_name}"
            cursor.execute(query)
            rows = cursor.fetchall()
            result = [dict(row) for row in rows]
            return result
    except sqlite3.Error as e:
        return {"error": str(e)}



@app.get("/fetch-projects")
def fetch_projects():
    return fetch_from_table("projects")


@app.get("/fetch-documents")
def fetch_documents():
    return fetch_from_table("documents")


@app.get("/fetch-classes")
def fetch_classes():
    return fetch_from_table("classes")


@app.get("/fetch-methods")
def fetch_methods():
    return fetch_from_table("methods")


@app.get("/fetch-method-calls")
def fetch_method_calls():
    return fetch_from_table("method_calls")


@app.get("/fetch-all")
def fetch_all():
    try:
        with get_db_connection() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            select_query = '''
                SELECT
                    prj.id as project_id, prj.name as project_name,
                    doc.id as document_id, doc.path as document_path,
                    class.id as class_id, class.name as class_name,
                    method.id as method_id,
                    method.name as method_name,
                    method.signature as method_signature,
                    method.body as method_body,
                    JSON_GROUP_ARRAY(
                        DISTINCT JSON_OBJECT('method_id', callee_method.id, 'signature', callee_method.signature)
                    ) FILTER (WHERE callee_method.id IS NOT NULL) as callees,
                    JSON_GROUP_ARRAY(
                        DISTINCT JSON_OBJECT('method_id', caller_method.id, 'signature', caller_method.signature)
                    ) FILTER (WHERE caller_method.id IS NOT NULL) as callers
            '''
            query = '''
            FROM methods as method
                INNER JOIN classes as class ON method.class_id = class.id
                INNER JOIN documents as doc ON class.document_id = doc.id
                INNER JOIN projects as prj ON doc.project_id = prj.id
                LEFT JOIN method_calls as callee_join ON method.id = callee_join.caller_id
                LEFT JOIN methods as callee_method ON callee_join.callee_id = callee_method.id
                LEFT JOIN method_calls as caller_join ON method.id = caller_join.callee_id
                LEFT JOIN methods as caller_method ON caller_join.caller_id = caller_method.id
                GROUP BY method.id
            '''
            cursor.execute(
                f'''
                        {select_query}
                        {query}
                '''
            )
            rows = cursor.fetchall()
            result = []
            for row in rows:
                row_dict = dict(row)
                row_dict['callees'] = json.loads(row_dict['callees']) if row_dict['callees'] else []
                row_dict['callers'] = json.loads(row_dict['callers']) if row_dict['callers'] else []
                result.append(row_dict)
            return result
    except sqlite3.Error as e:
        return {"error": str(e)}


@app.post("/update-indexes")
async def update_indexes(body: UpdateIndexesRequest):
    # Upload data to database
    try:
        projects: list[object] = body.projects  # Array

        try:
            with get_db_connection() as conn:
        
                for project in projects:
                    updater = UpdateIndexes(project, conn=conn)
                    result = updater.process()
                    if "error" in result:
                        return result

                # Respond with success
                return result;
        except Exception as e:
            return {"error": str(e)}
    except (sqlite3.Error, json.JSONDecodeError) as e:
        return {"error": str(e)}

