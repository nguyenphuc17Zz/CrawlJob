import uvicorn
from app.config import HOST, PORT

if __name__ == "__main__":
    # Bind strictly to 127.0.0.1 (localhost) per security guidelines
    uvicorn.run("app.main:app", host=HOST, port=PORT, reload=False)
