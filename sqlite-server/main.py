import sqlite3
import json
from contextlib import contextmanager
from typing import List
from tables import Tables
from fastapi import FastAPI, HTTPException
from update_indexes import UpdateIndexes
from pypika import Query, Table, terms
from models import ClassesResponse, DocumentsResponse, MethodCallsResponse, MethodsResponse, ProjectBody, FetchAllResponse, ProjectsResponse
from contextlib import asynccontextmanager
import uvicorn

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
def fetch_projects() -> dict[str, list[ProjectsResponse]]:
    return {"data": fetch_from_table("projects")}


@app.get("/fetch-documents")
def fetch_documents() -> dict[str, list[DocumentsResponse]]:
    return {"data": fetch_from_table("documents")}


@app.get("/fetch-classes")
def fetch_classes() -> dict[str, list[ClassesResponse]]:
    return {"data": fetch_from_table("classes")}


@app.get("/fetch-methods")
def fetch_methods() -> dict[str, list[MethodsResponse]]:
    return {"data": fetch_from_table("methods")}

@app.get("/fetch-method-calls")
def fetch_method_calls() -> dict[str, list[MethodCallsResponse]]:
    return {"data": fetch_from_table("method_calls")}

@app.get("/fetch-all")
def fetch_all() -> dict[str, list[FetchAllResponse]]:
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


            cursor.execute(str(q))
            rows = cursor.fetchall()

            def process_row(row):
                row_dict = dict(row)
                row_dict['callees'] = json.loads(row_dict['callees'] or '[]')
                row_dict['callers'] = json.loads(row_dict['callers'] or '[]')
                return row_dict
            
            return {"data": [process_row(row) for row in rows]}
    except sqlite3.Error as e:
        return {"error": str(e)}


@app.post("/update-indexes")
async def update_indexes(projects: List[ProjectBody]):
    # Upload data to database
    try:
        # The 'projects' argument is now directly the list of ProjectBody model objects.
        results = []
        try:
            print(f"[SQLITE SERVER] Updating indexes for {len(projects)} project(s)...")
            with get_db_connection() as conn:
                for project in projects:
                    updater = UpdateIndexes(project, conn=conn)
                    result = updater.process()
                    if "error" in result:
                        return result # Return early on first error
                    results.append(result)
            print("[SQLITE SERVER] Indexes updated successfully.")
            return results
        except Exception as e:
            return {"error": str(e)}
    except (sqlite3.Error, json.JSONDecodeError) as e:
        return {"error": str(e)}



# Get method from signature
@app.get("/method-from-signature")
def method_from_signature(signature: str, file_name: str):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.row_factory = sqlite3.Row


        # Define tables
        methods_table = Table('methods')
        classes_table = Table('classes')
        documents_table = Table('documents')

        query = Query.from_(methods_table) \
            .join(classes_table).on(methods_table.class_id == classes_table.id) \
            .join(documents_table).on(classes_table.document_id == documents_table.id) \
            .select(
                methods_table.id.as_('method_id'),
                methods_table.signature.as_('method_signature'),
                methods_table.body.as_('method_body'),
            ) \
            .where(
                (methods_table.signature == signature) &
                (documents_table.path == file_name)
            )
 


        cursor.execute(str(query))
        row = cursor.fetchone()
        print(row)
        if row:
            dict_row = dict(row)
            full_method = f'''{dict_row["method_signature"]}\n\t\t{dict_row["method_body"]}'''
            return {"method": full_method, "method_id": dict_row["method_id"]}
        else:
            raise HTTPException(status_code=404, detail="Method not found")

@app.get("/method/{method_id}")
def get_method(method_id: int):
    print("Getting method with id:", method_id)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.row_factory = sqlite3.Row
        methods_table = Table("methods")
        query = Query.from_(methods_table) \
            .select(
                methods_table.id.as_("method_id"),
                methods_table.signature.as_("method_signature"),
                methods_table.body.as_("method_body")
            ) \
            .where(methods_table.id == method_id)
        cursor.execute(str(query))
        row = cursor.fetchone()
        if row: 
            dict_row = dict(row)
            return dict_row
        else:
            raise HTTPException(status_code=404, detail="Method not found")

# Example of another function ( WE DONT USE THIS )
# def get_used_methods(method_id, data):
#     '''returns the methods called by the method with given id'''
#     callees = ""
#     for entry in data["data"]:
#         if entry["method_id"] == method_id:
#             for callee in entry["callees"]:
#                 callees+=(get_method_from_signature(callee["signature"],entry["document_path"],data)+"\n")
#     return callees

@app.get("/used-methods/{method_id}")
def used_methods(method_id: int):
    print("Getting used methods for method_id:", method_id)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.row_factory = sqlite3.Row
        # First, get the method signature and document path for the given method_id
        method_calls_table = Table("method_calls")
        methods_table = Table("methods")
        documents_table = Table("documents")
        classes_table = Table("classes")

        print("Fetching used methods for method_id:", method_id)
        query = Query.from_(method_calls_table) \
            .join(methods_table).on(method_calls_table.callee_id == methods_table.id) \
            .join(classes_table).on(methods_table.class_id == classes_table.id) \
            .join(documents_table).on(classes_table.document_id == documents_table.id) \
            .select(
                methods_table.id.as_("method_id"),
                methods_table.signature.as_("method_signature"),
                documents_table.path.as_("document_path")
            ) \
            .where(method_calls_table.caller_id == method_id) \
            .groupby(methods_table.id)

        cursor.execute(str(query))
        rows = cursor.fetchall()
        print(f"Found {len(rows)} used methods for method_id {method_id}")
        used_methods = [dict(row) for row in rows]
        return {"used_methods": used_methods}

@app.get("/related-methods/{method_id}")
def related_methods(method_id: int):
    print("Getting related methods for method_id:", method_id)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.row_factory = sqlite3.Row
        # First, get the method signature and document path for the given method_id
        method_calls_table = Table("method_calls")
        methods_table = Table("methods")
        classes_table = Table("classes")
        documents_table = Table("documents")

        print("Fetching related methods for method_id:", method_id)
        query = Query.from_(method_calls_table) \
            .join(methods_table).on(method_calls_table.caller_id == methods_table.id) \
            .join(classes_table).on(methods_table.class_id == classes_table.id) \
            .join(documents_table).on(classes_table.document_id == documents_table.id) \
            .select(
                methods_table.id.as_("method_id"),
                methods_table.signature.as_("method_signature"),
                documents_table.path.as_("document_path")
            ) \
            .where(method_calls_table.callee_id == method_id) \
            .groupby(methods_table.id)

        cursor.execute(str(query))
        rows = cursor.fetchall()
        print(f"Found {len(rows)} related methods for method_id {method_id}")
        related_methods = [dict(row) for row in rows]
        return {"related_methods": related_methods}

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)

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
