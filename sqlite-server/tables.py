class Tables:
    @staticmethod
    def define_tables():
        return [
            Tables.projects(),
            Tables.documents(),
            Tables.classes(),
            Tables.methods(),
            Tables.method_calls(),
        ]

    @staticmethod
    def projects():
        # Name of project, the folder holding the file(s)
        return """
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL UNIQUE
        )
        """

    @staticmethod
    def documents():
        # Is path to document, the full absolute path.
        return """
        CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY,
            project_id INTEGER NOT NULL,
            path TEXT NOT NULL UNIQUE,
            FOREIGN KEY(project_id) REFERENCES projects(id)
        )
        """

    @staticmethod
    def classes():
        # List of strings, representing <projectname>.<classname>
        return """
        CREATE TABLE IF NOT EXISTS classes (
            id INTEGER PRIMARY KEY,
            document_id INTEGER,
            name TEXT NOT NULL UNIQUE,
            FOREIGN KEY(document_id) REFERENCES documents(id)
        )
        """

    @staticmethod
    def methods():
        # List of objects
        # {
        #   "Signature": "<projectname>.<classname>.<methodname(opt params)>",
        #   "Body": "<string of method body>", -- Includes /n and {} if newlines are present, else is directly a string,
        # }
        return """
        CREATE TABLE IF NOT EXISTS methods (
            id INTEGER PRIMARY KEY,
            class_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            signature TEXT NOT NULL,
            start_line INTEGER,
            end_line INTEGER,
            body TEXT,
            FOREIGN KEY(class_id) REFERENCES classes(id)
        )
        """

    @staticmethod
    def method_calls():
        # List of Objects
        # {
        #   "Caller": "<projectname>.<classname>.<methodname(opt params)>", # Who is calling
        #   "Callee": "<projectname>.<classname>.<methodname(opt params)>", # Whom it calls
        # }
        return """
        CREATE TABLE IF NOT EXISTS method_calls (
            id INTEGER PRIMARY KEY,
            caller_id INTEGER NOT NULL,
            callee_id INTEGER NOT NULL,
            FOREIGN KEY(caller_id) REFERENCES methods(id),
            FOREIGN KEY(callee_id) REFERENCES methods(id)
        )
        """
