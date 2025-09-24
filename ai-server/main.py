from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
import ollama
import asyncio
import uvicorn

app = FastAPI()
chat = ollama.chat(
    model='gemma3:270m',
    messages=[{'role': 'user', 'content': 'Why is the sky blue?'}],
    stream=True,
)
async def generate_response(prompt):
    for chunk in chat:
        text = chunk['message']['content']
        print(text, end='', flush=True)
        yield f"data: {text}\n\n"
        await asyncio.sleep(0.1)

@app.get("/stream")
async def stream_response(prompt: str):
    return StreamingResponse(generate_response(prompt), media_type="text/event-stream")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=9999, reload=True)
