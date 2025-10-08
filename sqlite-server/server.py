import sqlite3
import json
from contextlib import contextmanager
from tables import Tables
from fastapi import FastAPI
from update_indexes import UpdateIndexes
from pypika import Query, Table, terms
from models import ClassesResponse, DocumentsResponse, MethodCallsResponse, MethodsResponse, UpdateIndexesRequest, FetchAllResponse, ProjectsResponse
from contextlib import asynccontextmanager

DB_NAME = "database.db"

# Makes sure that each time the server starts up, the database is initialized with the corret tables, it does not drop old tables.
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield
    print("Shutting down...")
    with get_db_connection() as conn:
        conn.close()
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
        print("Creating tables...") 
        for table in tables:
            cursor.execute(table)

        conn.commit()

# def drop_everything():
#     with get_db_connection() as conn:
#         cursor = conn.cursor()
#         cursor.execute("DROP TABLE IF EXISTS projects")
#         cursor.execute("DROP TABLE IF EXISTS documents")
#         cursor.execute("DROP TABLE IF EXISTS classes")
#         cursor.execute("DROP TABLE IF EXISTS methods")
#         cursor.execute("DROP TABLE IF EXISTS method_calls")
#         conn.commit()

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
def fetch_projects() -> list[ProjectsResponse]:
    return fetch_from_table("projects")


@app.get("/fetch-documents")
def fetch_documents() -> list[DocumentsResponse]:
    return fetch_from_table("documents")


@app.get("/fetch-classes")
def fetch_classes() -> list[ClassesResponse]:
    return fetch_from_table("classes")


@app.get("/fetch-methods")
def fetch_methods() -> list[MethodsResponse]:
    return fetch_from_table("methods")


@app.get("/fetch-method-calls")
def fetch_method_calls() -> list[MethodCallsResponse]:
    return fetch_from_table("method_calls")


@app.get("/fetch-all")
def fetch_all() -> FetchAllResponse:
    try:
        with get_db_connection() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            # Define tables
            methods_table = Table('methods')
            classes_table = Table('classes')
            documents_table = Table('documents')
            projects_table = Table('projects')
            method_calls_table = Table('method_calls')

            # Aliases
            method = methods_table.as_('method')
            class_ = classes_table.as_('class')
            doc = documents_table.as_('doc')
            prj = projects_table.as_('prj')
            callee_join = method_calls_table.as_('callee_join')
            callee_method = methods_table.as_('callee_method')
            caller_join = method_calls_table.as_('caller_join')
            caller_method = methods_table.as_('caller_method')

            # Finds the distinct callees and callers for each method
            # using literal value of the sql instead of pypika, since pypika does not support JSON_GROUP_ARRAY
            callees_clause = terms.LiteralValue(
                "JSON_GROUP_ARRAY(DISTINCT JSON_OBJECT('id', callee_method.id, 'signature', callee_method.signature)) FILTER (WHERE callee_method.id IS NOT NULL)"
            ).as_('callees')

            callers_clause = terms.LiteralValue(
                "JSON_GROUP_ARRAY(DISTINCT JSON_OBJECT('id', caller_method.id, 'signature', caller_method.signature)) FILTER (WHERE caller_method.id IS NOT NULL)"
            ).as_('callers')

            # Understanding this query:
            # Firstly, it selects from the methods table as the primary table.
            # it joins the classes, documents, and projects tables to get the context of each method.
            # The context being the: class it belongs to, the document it is in, and the project it is part of.
            # Furthermore it left joins the method_calls table twice to get both the methods that are called
            # by the current method (callees)
            # and the methods that call the current method (callers).
            # Finally, it groups the results by method.id to ensure each method is represented once in the final output,
            # with aggregated lists of its callees and callers.
            # See @type FetchAllResponse for the expected output format.

            q = Query.from_(method) \
                .join(class_).on(method.class_id == class_.id) \
                .join(doc).on(class_.document_id == doc.id) \
                .join(prj).on(doc.project_id == prj.id) \
                .left_join(callee_join).on(method.id == callee_join.caller_id) \
                .left_join(callee_method).on(callee_join.callee_id == callee_method.id) \
                .left_join(caller_join).on(method.id == caller_join.callee_id) \
                .left_join(caller_method).on(caller_join.caller_id == caller_method.id) \
                .select(
                    prj.id.as_('project_id'),
                    prj.name.as_('project_name'),
                    doc.id.as_('document_id'),
                    doc.path.as_('document_path'),
                    class_.id.as_('class_id'),
                    class_.name.as_('class_name'),
                    method.id.as_('method_id'),
                    method.name.as_('method_name'),
                    method.signature.as_('method_signature'),
                    method.body.as_('method_body'),
                    callees_clause,
                    callers_clause
                ) \
                .groupby(method.id)


            print(str(q))
            cursor.execute(str(q))
            rows = cursor.fetchall()

            def process_row(row):
                row_dict = dict(row)
                print(row_dict)
                row_dict['callees'] = json.loads(row_dict['callees'] or '[]')
                row_dict['callers'] = json.loads(row_dict['callers'] or '[]')
                return row_dict
            
            print(f"Fetched {len(rows)} rows")
            return [process_row(row) for row in rows]
    except sqlite3.Error as e:
        return {"error": str(e)}


@app.post("/update-indexes")
async def update_indexes(body: UpdateIndexesRequest):
    # Upload data to database
    try:
        projects: list[object] = body.projects  # List of projects
        results = []
        try:
            with get_db_connection() as conn:
                for project in projects:
                    updater = UpdateIndexes(project, conn=conn)
                    result = updater.process()
                    if "error" in result:
                        return result # Return early on first error
                    results.append(result)

            return results
        except Exception as e:
            return {"error": str(e)}
    except (sqlite3.Error, json.JSONDecodeError) as e:
        return {"error": str(e)}


# Old query
            # query = '''
            #     SELECT
            #         prj.id as project_id, prj.name as project_name,
            #         doc.id as document_id, doc.path as document_path,
            #         class.id as class_id, class.name as class_name,
            #         method.id as method_id, method.name as method_name,
            #         method.signature as method_signature, method.body as method_body,
            #         JSON_GROUP_ARRAY(
            #             DISTINCT JSON_OBJECT('id', callee_method.id, 'signature', callee_method.signature)
            #         ) FILTER (WHERE callee_method.id IS NOT NULL) as callees,
            #         JSON_GROUP_ARRAY(
            #             DISTINCT JSON_OBJECT('id', caller_method.id, 'signature', caller_method.signature)
            #         ) FILTER (WHERE caller_method.id IS NOT NULL) as callers
            #     FROM methods as method
            #         INNER JOIN classes as class ON method.class_id = class.id
            #         INNER JOIN documents as doc ON class.document_id = doc.id
            #         INNER JOIN projects as prj ON doc.project_id = prj.id
            #         LEFT JOIN method_calls as callee_join ON method.id = callee_join.caller_id
            #         LEFT JOIN methods as callee_method ON callee_join.callee_id = callee_method.id
            #         LEFT JOIN method_calls as caller_join ON method.id = caller_join.callee_id
            #         LEFT JOIN methods as caller_method ON caller_join.caller_id = caller_method.id
            #         GROUP BY method.id
            # '''
            # cursor.execute(query)
