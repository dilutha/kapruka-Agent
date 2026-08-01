# 🛍️ Kapruka AI Shopping Assistant

<div align="center">

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)
![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?logo=supabase)
![Redis](https://img.shields.io/badge/Redis-Cache-DC382D?logo=redis)
![Gemini](https://img.shields.io/badge/Google-Gemini_AI-4285F4?logo=google)
![LangGraph](https://img.shields.io/badge/LangGraph-AI_Workflow-blue)
![MCP](https://img.shields.io/badge/MCP-Kapruka-orange)

### 🚀 Intelligent Multilingual AI Shopping Assistant for E-Commerce

**Final Year Project**

An AI-powered conversational shopping assistant that helps customers discover products, receive personalized recommendations, complete purchases, and track orders through natural conversations in **English, Sinhala, and Singlish**.

</div>

---

# 📖 Overview

Kapruka AI Shopping Assistant is a modern AI-powered e-commerce assistant built for the Kapruka shopping platform.

Instead of searching products using traditional filters and keywords, customers simply chat naturally with the AI.

The assistant understands:

- 🎁 Shopping intent
- 💰 Budget
- 🎉 Occasion
- ❤️ Recipient
- 📍 Delivery location
- 🛒 Shopping context
- 🌍 Multiple languages

It then intelligently searches the Kapruka product catalog using the **Kapruka MCP Server**, recommends the most relevant products, guides users through checkout, and assists with order tracking.

---

# ✨ Features

## 🤖 AI Shopping Assistant

- Natural conversational shopping
- Human-like AI assistant
- Personalized recommendations
- Shopping guidance
- Intelligent product discovery
- Context-aware conversations
- AI-powered checkout

---

## 🌍 Multilingual Support

Supports:

- 🇺🇸 English
- 🇱🇰 Sinhala
- 💬 Singlish
- Mixed-language conversations

Examples:

```
Hi

Mage girlfriend ge birthday ekata gift ekak one

මගේ අම්මට gift එකක්

Need flowers under Rs.5000
```

The AI automatically detects the language and responds naturally.

---

## 🧠 Intelligent Shopping Understanding

The assistant automatically understands:

- Shopping Intent
- Product Category
- Recipient
- Occasion
- Budget
- Delivery Location
- Delivery Date
- Conversation Context

Example

User:

```
Mage girlfriend ge birthday ekata Rs.5000 wage gift ekak one
```

Automatically extracts

```
Recipient:
Girlfriend

Occasion:
Birthday

Budget:
Rs.5000

Category:
Gift
```

without asking unnecessary questions.

---

# 🎁 Product Recommendations

The AI provides:

- Personalized Recommendations
- Budget-aware Recommendations
- Occasion-based Suggestions
- Recipient-based Suggestions
- Cross-selling
- Upselling
- Product Comparison
- Related Products

---

# 🔍 Smart Product Search

Natural language search.

Examples

```
Birthday cakes

Flowers

Wedding gifts

Baby gifts

Electronics

Chocolates

Gift hampers

Home decor
```

---

# 🖼 Rich Product Experience

Each recommendation displays

- Product Images
- Product Cards
- Price
- Description
- Availability
- Delivery Information
- Buy Now
- Add to Cart
- Wishlist
- Product Comparison

---

# 🛒 Shopping Features

- Add to Cart
- Buy Now
- Wishlist
- Product Comparison
- Product Details
- Similar Products
- Related Products

---

# 💬 Conversation Memory

The AI remembers

- Budget
- Recipient
- Occasion
- Selected Products
- Shopping History
- Delivery Details
- Checkout Information

Example

```
User:
Show cheaper ones

↓

AI understands previous recommendations.
```

---

# 🚚 AI-Powered Checkout

The assistant naturally collects

- Recipient Name
- Phone Number
- Delivery Address
- City
- District
- Postal Code
- Delivery Date
- Gift Message
- Special Instructions

These details automatically populate the checkout form.

---

# 📦 Order Management

Users can

- Create Orders
- Track Orders
- Check Delivery Status
- View Estimated Delivery

---

# 💬 Modern Chat Experience

- Real-time Streaming
- Typing Animation
- Markdown Support
- Rich Product Cards
- Suggested Replies
- Quick Actions
- Auto Scroll
- Copy Responses
- Regenerate Responses

---

# 📁 Chat Management

- New Chat
- Rename Chat
- Delete Chat
- Archive Chat
- Search Chats
- Chat History

---

# ⚡ Performance Optimizations

- Redis Caching
- Parallel AI Processing
- Optimized Gemini Prompts
- Reduced Token Usage
- MCP Caching
- Streaming Responses
- Lazy Loading
- Optimized Images

---

# 🔄 AI Workflow

```text
User Message
      │
      ▼
Language Detection
      │
      ▼
Intent Classification
      │
      ▼
Entity Extraction
      │
      ▼
Shopping Context
      │
      ▼
Kapruka MCP Search
      │
      ▼
Product Ranking
      │
      ▼
Gemini Response Generation
      │
      ▼
Interactive Product Cards
      │
      ▼
Checkout
      │
      ▼
Order Creation
```

---

# 🏗️ System Architecture

```text
                    ┌─────────────────────┐
                    │     Next.js App     │
                    │     (Frontend)      │
                    └──────────┬──────────┘
                               │
                     REST API / SSE
                               │
                               ▼
                    ┌─────────────────────┐
                    │      NestJS API     │
                    │      Backend        │
                    └──────────┬──────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
   Google Gemini         Kapruka MCP           Redis Cache
        AI                 Product API         Session Cache
          │                    │                    │
          └────────────────────┼────────────────────┘
                               ▼
                      Supabase PostgreSQL
```

---

# 🛠 Technology Stack

## Frontend

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- Next/Image
- Server-Sent Events (SSE)

---

## Backend

- NestJS
- Node.js
- TypeScript
- Prisma ORM
- REST API

---

## Artificial Intelligence

- Google Gemini 2.5
- Google GenAI SDK
- LangGraph
- LangChain
- Prompt Engineering
- Structured JSON Responses

---

## Database

- Supabase PostgreSQL
- Prisma ORM

---

## Authentication

- Clerk Authentication
- Guest Authentication

---

## Caching

- Redis

Used for

- AI State
- Conversation Memory
- Product Cache
- Session Cache

---

## MCP Integration

Kapruka MCP Server

Supported Tools

- Product Search
- Product Details
- Categories
- Delivery Cities
- Delivery Validation
- Order Creation
- Order Tracking

---

# 📂 Project Structure

```text
kapruka-ai-shopping-assistant/

├── frontend/             # Next.js Application
│   ├── app/
│   ├── components/
│   ├── lib/
│   ├── hooks/
│   └── styles/
│
├── backend/              # NestJS API
│   ├── src/
│   │   ├── ai/
│   │   ├── modules/
│   │   ├── redis/
│   │   ├── mcp/
│   │   └── prisma/
│   └── prisma/
│
└── README.md
```

---

# 🚀 Installation

## Clone

```bash
git clone https://github.com/YOUR_USERNAME/kapruka-ai-shopping-assistant.git

cd kapruka-ai-shopping-assistant
```

---

## Install Frontend

```bash
cd frontend

npm install
```

---

## Install Backend

```bash
cd backend

npm install
```

---

# ⚙ Environment Variables

Backend

```env
DATABASE_URL=
DIRECT_URL=

GEMINI_API_KEY=

CLERK_SECRET_KEY=

CLERK_PUBLISHABLE_KEY=

REDIS_URL=

KAPRUKA_MCP_SERVER_URL=
```

Frontend

```env
NEXT_PUBLIC_API_URL=

NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
```

---

# ▶ Running the Project

Backend

```bash
cd backend

npm run start:dev
```

Frontend

```bash
cd frontend

npm run dev
```

---

# 📈 Future Improvements

- Voice Shopping
- Image-based Search
- AI Gift Planner
- Personalized Recommendations using User History
- AI Shopping Analytics
- Mobile Application
- Multi-vendor Support
- Payment Gateway Integration
- AI Price Prediction
- AI Wishlist Recommendations

---



# 👨‍💻 Author

**Dilutha Weerasinghe**

### Education

🎓 **MSc Applied Artificial Intelligence** *(Reading)*  
**University of Westminster** *(Informatics Institute of Technology - IIT)*

🎓 **BSc (Hons) Business Information Systems (Special)** *(Undergraduate)*  
**University of Sri Jayewardenepura**

🎓 **BSc (Hons) Data Science**  
**Cardiff Metropolitan University**

---

This project was developed as part of my academic journey, combining expertise in **Artificial Intelligence, Data Science, Business Information Systems, Full-Stack Software Engineering, and Conversational AI** to build a modern AI-powered e-commerce shopping assistant.

---

# 🙏 Acknowledgements

- Kapruka
- Google Gemini AI
- Model Context Protocol (MCP)
- LangGraph
- LangChain
- Next.js
- NestJS
- Supabase
- Clerk
- Redis

---

# 📄 License

This project was developed for academic and demonstration purposes.

---

<div align="center">

### ⭐ If you found this project interesting, consider giving it a star!

Made with ❤️ using Next.js, NestJS, Google Gemini, LangGraph, Supabase & Kapruka MCP.

</div>
