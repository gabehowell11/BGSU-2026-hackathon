import os
import aivana
from dotenv import load_dotenv

load_dotenv()
aivana.api_key = os.environ["AIVANA_API_KEY"]

res = aivana.generate("Say hello in five words.", max_tokens=50)
print("Answer:", res.answer)