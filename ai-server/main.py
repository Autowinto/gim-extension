from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import ollama
import asyncio
import uvicorn

app = FastAPI()

def get_chat(model, prompt):
    chat = ollama.chat(
    model=model,
    messages=[{'role': 'user', 'content': prompt}],
    stream=True,
)
    return chat


async def generate_response(model, prompt):
    for chunk in get_chat(model, prompt):
        text = chunk['message']['content']
        print(text, end='', flush=True)
        yield f"data: {text}\n\n"
        await asyncio.sleep(0.1)

@app.get("/stream")
async def stream_response(model, prompt):
    return StreamingResponse(generate_response(model=model, prompt=prompt), media_type="text/event-stream")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=9999, reload=True)
