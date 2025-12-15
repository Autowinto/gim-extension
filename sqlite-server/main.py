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

description = """
This API provides endpoints to interact with a SQLite database for managing projects, documents, classes, methods, and method calls.
It allows fetching and updating indexed data, retrieving methods by signature or ID, and exploring relationships between methods such as callers and callees. 
The server ensures the database schema is initialized on startup and supports bulk updates of project indexes.
"""

tags_metadata = [
    {
        "name": "Projects",
        "description": "Operations related to projects in the database.",
    },
    {
        "name": "Documents",
        "description": "Operations related to documents in the database.",
    },
    {
        "name": "Classes",
        "description": "Operations related to classes in the database.",
    },
    {
        "name": "Methods",
        "description": "Operations related to methods in the database.",
    },
    {
        "name": "Method Calls",
        "description": "Operations related to method calls in the database.",
    },
    {
        "name": "Fetch All",
        "description": "Fetch comprehensive data including projects, documents, classes, methods, and their relationships.",
    },
    {
        "name": "Update Indexes",
        "description": "Update indexes for projects by uploading project data.",
    },
    {
        "name": "Method Retrieval",
        "description": "Retrieve methods by signature or ID, and explore related methods.",
    },
    {
        "name": "Used Methods",
        "description": "Retrieve methods that are called by a specific method.",
    },
    {
        "name": "Related Methods",
        "description": "Retrieve methods that call a specific method.",
    }
]

# Makes sure that each time the server starts up, the database is initialized with the corret tables, it does not drop old tables.
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield
    print("Shutting down...")
    with get_db_connection() as conn:
        conn.close()
app = FastAPI(title="SQLite Server", openapi_tags=tags_metadata, description=description,lifespan=lifespan)

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



@app.get("/fetch-projects", tags=["Projects"])
def fetch_projects() -> dict[str, list[ProjectsResponse]]:
    """
    Fetch projects from the database.
    """
    return {"data": fetch_from_table("projects")}


@app.get("/fetch-documents", tags=["Documents"])
def fetch_documents() -> dict[str, list[DocumentsResponse]]:
    """
    Fetch documents from the database.
    """
    return {"data": fetch_from_table("documents")}


@app.get("/fetch-classes", tags=["Classes"])
def fetch_classes() -> dict[str, list[ClassesResponse]]:
    """
    Fetch classes from the database.
    """
    return {"data": fetch_from_table("classes")}


@app.get("/fetch-methods", tags=["Methods"])
def fetch_methods() -> dict[str, list[MethodsResponse]]:
    """
    Fetch methods from the database.
    """
    return {"data": fetch_from_table("methods")}

@app.get("/fetch-method-calls", tags=["Method Calls"])
def fetch_method_calls() -> dict[str, list[MethodCallsResponse]]:
    """
    Fetch method calls from the database.
    """
    return {"data": fetch_from_table("method_calls")}

@app.get("/fetch-all", tags=["Fetch All"])
def fetch_all() -> dict[str, list[FetchAllResponse]]:
    """
    Fetch all data including projects, documents, classes, methods, and their relationships.
    """
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
                    method.start_line.as_('method_start_line'),
                    method.end_line.as_('method_end_line'),
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


@app.post("/update-indexes", tags=["Update Indexes"])
async def update_indexes(projects: List[ProjectBody]):
    """
    Update indexes for the given projects, uploading a list of projects to update indexes for.
    """
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
@app.get("/method-from-signature", tags=["Method Retrieval"])
def method_from_signature(signature: str, file_name: str):
    """
        Get method from signature
    """
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

@app.get("/method/{method_id}", tags=["Method Retrieval"])
def get_method(method_id: int):
    """
        Get method from id
    """
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

@app.get("/used-methods/{method_id}", tags=["Used Methods"])
def used_methods(method_id: int):
    """
        Get methods used by the method with given id
    """
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

@app.get("/related-methods/{method_id}", tags=["Related Methods"])
def related_methods(method_id: int):
    """
        Get methods related to the method with given id
    """
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
