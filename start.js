import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
const model = new ChatGoogleGenerativeAI({
  model: "gemma-3-12b-it",
  temperature: 0.7,
  maxOutputTokens: 2048,
});

const response = await model.invoke("Hello, I'm Ej and I'm a software engineer and trying to learn AI");
console.log(response);