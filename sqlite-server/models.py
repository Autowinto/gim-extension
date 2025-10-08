
from pydantic import BaseModel


class MethodsBody(BaseModel):
    Signature: str
    Body: str

class CallsBody(BaseModel):
    Caller: str
    Callee: str

class ProjectBody(BaseModel):
    Project: str
    Document: str
    Classes: list[str]
    Methods: list[MethodsBody]
    Calls: list[CallsBody]

class UpdateIndexesRequest(BaseModel):
    projects: list[ProjectBody]

class CallsResponseBody(BaseModel):
    id: int # Method id 
    signature: str

class FetchAllResponse(BaseModel):
    project_id: int
    project_name: str
    document_id: int
    document_path: str
    class_id: int
    class_name: str
    method_id: int
    method_name: str
    method_signature: str
    method_body: str
    calles: list[CallsResponseBody] # Methods that this method calls
    callers: list[CallsResponseBody] # Methods that call this method

class ProjectsResponse(BaseModel):
    id: int
    name: str

class DocumentsResponse(BaseModel):
    id: int
    project_id: int
    path: str

class ClassesResponse(BaseModel):
    id: int
    document_id: int
    name: str

class MethodsResponse(BaseModel):
    id: int
    class_id: int
    name: str
    signature: str
    body: str

class MethodCallsResponse(BaseModel):
    id: int
    caller_id: int
    callee_id: int

class UpdateIndexesResponse(BaseModel):
    id: int
    status: str