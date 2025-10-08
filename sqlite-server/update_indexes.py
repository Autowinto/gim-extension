from models import ProjectBody
# Helper class to process the update of a single project at a time
class UpdateIndexes: 
    def __init__(self, body: ProjectBody, conn=None):
        self.body = body
        self.conn = conn
        self.document = None
        self.projectName = None
        self.classes = None
        self.methods = None
        self.calls = None
        self.new_id = None

    def process(self):
        self.projectName = self.body.Project
        self.document = self.body.Document
        self.classes = self.body.Classes
        self.methods = self.body.Methods
        self.calls = self.body.Calls
        cursor = self.conn.cursor()
        project_id = self.insert_project(cursor, self.projectName)
        document_id = self.insert_document(cursor, project_id, self.document)
        class_id_map = self.insert_classes(cursor, document_id, self.classes)
        self.insert_methods(cursor, self.methods, class_id_map, project_id)
        self.insert_method_calls(cursor, self.calls)
        return self.commit(cursor)

    def insert_project(self, cursor, projectName):
        cursor.execute("SELECT id FROM projects WHERE name = ?", (projectName,))
        existing_project = cursor.fetchone()
        if existing_project:
            project_id = existing_project[0]
        else:
            cursor.execute(
                "INSERT INTO projects (name) VALUES (?)", (projectName,)
            )
            project_id = cursor.lastrowid
        return project_id

    def insert_document(self, cursor, project_id, document):
        cursor.execute("SELECT id FROM documents WHERE path = ?", (document,))
        existing_document = cursor.fetchone()
        if existing_document:
            document_id = existing_document[0]
        else:
            cursor.execute(
                "INSERT INTO documents (project_id, path) VALUES (?, ?)",
                (project_id, document),
            )
            document_id = cursor.lastrowid
        return document_id
    
    def insert_classes(self, cursor, document_id, classes):
        class_id_map = {}
        for cls in classes:
            cursor.execute("SELECT id FROM classes WHERE name = ?", (cls,))
            existing_class = cursor.fetchone()
            if existing_class:
                print(f"Class already exists: {cls}")
                class_id = existing_class[0]
            else:
                print(f"Inserting class: {cls}")
                cursor.execute(
                    "INSERT INTO classes (document_id, name) VALUES (?, ?)",
                    (document_id, cls),
                )
                class_id = cursor.lastrowid
            class_id_map[cls] = class_id
        return class_id_map
    
    def insert_methods(self, cursor, methods, class_id_map, project_id):
        for method in methods:
            cursor.execute("SELECT id FROM methods WHERE signature = ?", (method.Signature,))
            existing_method = cursor.fetchone()
            method_id = None
            body = method.Body
            if existing_method:
                print(f"Method already exists, updating body: {method.Signature}")
                method_id = existing_method[0]
                cursor.execute("UPDATE methods SET body = ? WHERE id = ?", (body, method_id))
                continue  # Skip inserting if method already exists
            else:
                print(f"Inserting method: {method.Signature}")
                signature = method.Signature
                class_name = ".".join(signature.split(".")[:-1])
                method_name = signature.split(".")[-1]
                class_id = class_id_map.get(class_name)
                if class_id:
                    cursor.execute(
                        "INSERT INTO methods (class_id, name, signature, body) VALUES (?, ?, ?, ?)",
                        (class_id, method_name, signature, body),
                    )
            
                
    def insert_method_calls(self, cursor, method_calls):
        for call in method_calls:
            caller_signature = call.Caller
            callee_signature = call.Callee
            cursor.execute(
                "SELECT id FROM methods WHERE signature = ?",
                (caller_signature,),
            )
            caller_row = cursor.fetchone()
            # The callee signature might be incomplete, so we use LIKE
            cursor.execute(
                "SELECT id FROM methods WHERE signature LIKE ?",
                (callee_signature + "%",),
            )
            callee_row = (
                cursor.fetchone()
            )  # This will get the first match, which is fine if no overloads
            if caller_row and callee_row:
                caller_id = caller_row[0]
                callee_id = callee_row[0]
                cursor.execute(
                    "INSERT INTO method_calls (caller_id, callee_id) VALUES (?, ?)",
                    (caller_id, callee_id),
                )
            else:
                continue
        return
    
    def commit(self, cursor=None):
        try:
            if cursor:
                self.conn.commit()
                self.new_id = cursor.lastrowid
            return {"id": self.new_id, "status": "success"}
        except Exception as e:
            return {"error": str(e)}