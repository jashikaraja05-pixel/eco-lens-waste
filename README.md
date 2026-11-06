# ECO-LENS-AI — AI-Powered Smart Waste Segregation System

**Scan. Sort. Save.**

**Neural Storm 2026 · Track: Green Planet · Problem Statement GP-05: Smart Waste Segregation System**

| | |
|---|---|
| Team Name | solo stack |
| Team Leader | Jashika R |
| Institution | Rathinam Technical Campus |
| GitHub Repository | https://github.com/jashikaraja05-pixel/eco-lens-waste |
| Live Application | https://eco-lens-waste.lovable.app |
| Demo Video | [Watch ECO-LENS-AI Demo](https://drive.google.com/file/d/1YGdSYP2cZFC_ar5uKUi2GesWO0AZiHfv/view?usp=sharing) |

![Sign-in screen](docs/screenshots/auth.png)

---

## 1. Problem Statement

Incorrect waste segregation causes environmental pollution and reduces recycling efficiency. Mixed household waste spoils recycling streams and sends hazardous items such as batteries and electronic waste to landfills.

Many people do not know which waste bin an item belongs in. Traditional printed segregation guides are also difficult to remember and follow consistently.

An intelligent, accessible, and easy-to-use waste identification system can help people make better waste disposal decisions and promote responsible waste management.

## 2. Proposed Solution

ECO-LENS-AI is an AI-powered smart waste segregation application that helps users identify and dispose of waste responsibly.

Users can upload an image or capture a photo using their device camera. The AI-powered classification system identifies the waste item, assigns it to an appropriate waste category, recommends the correct disposal bin, and provides useful disposal instructions and safety guidance.

The application supports five main waste categories:

- Organic
- Recyclable
- Hazardous
- E-Waste
- Residual

When the prediction is uncertain, the application displays an **Uncertain** result and recommends rescanning instead of presenting an unreliable classification.

ECO-LENS-AI also provides user authentication, private scan history, a personal dashboard, and a Learn Hub to promote responsible waste management.

The project also includes a separately trained 13-class MobileNetV3-Small model that can be integrated through the Python FastAPI backend.

## 3. Objectives

- Make correct waste segregation a simple task for households.
- Use AI-assisted image classification to identify waste items.
- Recommend appropriate waste bins and disposal instructions.
- Avoid unreliable predictions through an uncertainty mechanism.
- Maintain private scan history for individual users.
- Promote awareness about recycling and responsible waste disposal.
- Provide a path to integrate a self-hosted trained machine learning model.

## 4. Key Features

- **User Authentication:** Email and password-based registration and login with email confirmation.
- **Image Upload:** Upload waste images for AI classification.
- **Live Camera Capture:** Capture waste images directly using the device camera.
- **AI Waste Classification:** Identify waste items and assign suitable categories.
- **Bin Recommendation:** Recommend the appropriate disposal bin.
- **Disposal Instructions:** Provide explanations, disposal steps, safety notes, and reuse tips.
- **Uncertain Detection:** Low-confidence predictions use a 55% threshold and can request a rescan.
- **Error Handling:** Invalid uploads and classification failures are handled with clear error messages.
- **Private Scan History:** Search, filter, view, and delete saved scan records.
- **Personal Dashboard:** Display scan totals, category statistics, active days, and other personal metrics.
- **Learn Hub:** Provide waste management guides, recycling information, composting guidance, and battery/e-waste safety information.
- **Optional Python Backend:** Includes a FastAPI service and a separately trained PyTorch model.

## 5. System Architecture

flowchart TD
    A[User] --> B[ECO-LENS-AI Web Application]
    B --> C[Authentication - Supabase]
    B --> D[Waste Image Upload]
    D --> E[Lovable AI Gateway]
    E --> F[Waste Classification]
    F --> G[13 Waste Categories]
    G --> H[AI Result and Confidence]
    H --> I[Bin Recommendation]
    H --> J[Disposal Guidance]
    I --> K[Dashboard and Scan History]
    J --> K

    L[Separately Trained PyTorch Model] -.-> M[FastAPI Classification Service]
    M -. Not yet deployed or connected to live app .-> B

    
### Currently Deployed Application

- Frontend and application services are hosted through Lovable Cloud.
- Authentication and scan history are managed through the application backend.
- Waste classification currently uses the Lovable AI Gateway vision model.
- The application validates predictions and applies a fixed server-side waste-bin mapping.

### Trained Machine Learning Model

- Architecture: MobileNetV3-Small.
- Framework: PyTorch.
- Number of classes: 13.
- Trained model weights and configuration files are available in the GitHub repository.
- Model evaluation results are documented in the Testing section.

### Backend Integration Status

The Python FastAPI service is available in the repository, but it has not yet been deployed and connected to the live application.

Therefore, the live website currently uses the Lovable AI Gateway, not the separately trained PyTorch model.

## 6. Technology Stack

| Component | Technologies |
|---|---|
| Frontend | React 19, TanStack Start |
| Styling | Tailwind CSS v4, shadcn/ui |
| Icons | lucide-react |
| Application Backend | Lovable Cloud |
| Database | PostgreSQL |
| Authentication | Lovable Cloud Authentication |
| AI Classification | Lovable AI Gateway |
| Machine Learning | PyTorch |
| Model Architecture | MobileNetV3-Small |
| Python Backend | FastAPI, Uvicorn |
| ML Libraries | torchvision, scikit-learn |
| Frontend Testing | Vitest |
| Backend Testing | pytest |
| End-to-End Testing | Playwright |

## 7. AI Classification Workflow

The application follows the workflow below:

1. The user signs in and uploads a waste image or captures one using the camera.
2. The browser resizes the image to a maximum dimension of 768 pixels.
3. The image is sent to the `classifyWaste` server function.
4. The server validates the image format, size, and file signature.
5. The selected AI engine generates the classification result.
6. `normalizePrediction` (`src/lib/scan-schema.ts`) validates the output.
7. The application applies the 55% uncertainty rule.
8. A fixed server-side mapping determines the recommended waste bin.
9. The classification result is saved to the user's private scan history.
10. The result is displayed to the user with disposal instructions.

**Important:** Confidence from the built-in vision AI is self-reported by the model. The application labels it as AI-estimated confidence. It is not measured model accuracy.

## 8. Categories and Model Coverage

The trained MobileNetV3-Small model supports 13 waste classification classes.

### Trained Model Classes

| No. | Class |
|---:|---|
| 1 | Battery |
| 2 | Biological |
| 3 | Brown Glass |
| 4 | Cardboard |
| 5 | Clothes |
| 6 | E-Waste |
| 7 | Green Glass |
| 8 | Metal |
| 9 | Paper |
| 10 | Plastic |
| 11 | Shoes |
| 12 | Trash |
| 13 | White Glass |

### Application Waste Categories

The application organizes waste into five main categories:

- Organic
- Recyclable
- Hazardous
- E-Waste
- Residual

The trained model provides fine-grained waste classification. The live application's current classification engine remains the Lovable AI Gateway until the Python model service is deployed and integrated.

**Important Limitation:** The trained model's 13 classes do not represent comprehensive hazardous-waste detection. It should not be considered a chemical, medicine, or aerosol detection system.

## 9. Dataset Information and Attribution

The MobileNetV3-Small model was trained using a combined dataset consisting of Garbage12 and GIZ E-Waste images.

### Dataset Sources

**1. Garbage12 Dataset**

- Used for waste image classification and training.
- Images were organized into the required waste classification classes.
- The dataset is used subject to the original provider's license and attribution requirements.
- The original dataset source and license must be acknowledged.

**2. GIZ E-Waste Database**

- Used to support electronic waste classification.
- Licensed under Creative Commons Attribution 4.0 International (CC BY 4.0).
- Appropriate attribution must be provided according to the license terms.

### Dataset Preparation

- Images from the selected datasets were organized into 13 waste classification classes.
- Training, validation, and testing datasets were separated.
- The test dataset was kept separate for model evaluation.
- Dataset images are not included in this GitHub repository.
- The `backend/data/` directory is excluded through `.gitignore`.

### Model Files

The trained MobileNetV3-Small model files are available in:

`backend/models/`

These include:

- `best.pt` – trained model weights.
- `config.json` – model configuration.
- `evaluation_report.json` – model evaluation results.
- `training_summary.json` – training summary.

All dataset sources and their respective license requirements must be acknowledged when redistributing or reusing the datasets.

## 10. Installation

Follow these steps to set up the ECO-LENS-AI project on your local machine.

### Prerequisites

Make sure the following tools are installed:

- Git
- Bun (JavaScript runtime and package manager)
- Python 3.10 or later
- pip (Python package manager)

### Step 1: Clone the Repository

```bash
git clone https://github.com/jashikaraja05-pixel/eco-lens-waste.git
cd eco-lens-waste
```

### Step 2: Configure Frontend Environment Variables

**Windows (PowerShell):**

```powershell
Copy-Item .env.example .env
```

**Linux / macOS:**

```bash
cp .env.example .env
```

Add the required configuration values to the `.env` file.

Do not share or commit private API keys, passwords, or secret credentials.

### Step 3: Frontend Setup

Install frontend dependencies:

```bash
bun install
```

Start the frontend development server:

```bash
bun run dev
```

Open the local development URL shown in the terminal. The default application URL is:

`http://localhost:8080`

### Step 4: Python Backend Setup (Optional)

The Python FastAPI service is available as an optional local backend.

Navigate to the backend directory:

```bash
cd backend
```

Create a Python virtual environment:

```bash
python -m venv .venv
```

Activate the virtual environment.

**Windows (PowerShell):**

```powershell
.venv\Scripts\Activate.ps1
```

**Linux / macOS:**

```bash
source .venv/bin/activate
```

Install the Python dependencies:

```bash
pip install -r requirements.txt
```

### Step 5: Configure Backend Environment

**Windows (PowerShell):**

```powershell
Copy-Item .env.example .env
```

**Linux / macOS:**

```bash
cp .env.example .env
```

Configure the required backend environment variables, including `CLASSIFIER_API_KEY`, in the backend `.env` file.

### Step 6: Run the Python Backend

Start the FastAPI service:

```bash
uvicorn main:app --reload --port 8000
```

The backend API will be available at:

`http://localhost:8000`

Check the service health endpoint:

`http://localhost:8000/health`

### Step 7: Trained Model Files

The trained model and its configuration files are included in:

```text
backend/models/
```

The directory contains:

- `best.pt`
- `config.json`
- `evaluation_report.json`
- `training_summary.json`

For additional model training and evaluation instructions, refer to the backend documentation.

### Important Deployment Note

The live ECO-LENS-AI application currently uses the Lovable AI Gateway for image classification.

The Python FastAPI backend and trained PyTorch model are available in the repository for local setup and future integration. The Python backend is not currently deployed or connected to the live application.

## 11. Environment Variables

| Name | Where | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | Web app | Database connection |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Web app | Public authentication/database key |
| `VITE_SUPABASE_PROJECT_ID` | Web app | Project identification |
| `LOVABLE_API_KEY` | App server | Built-in AI classification |
| `PYTHON_CLASSIFIER_URL` | App server (optional) | Route scans to Python service |
| `PYTHON_CLASSIFIER_API_KEY` | App server (optional) | Sent as `X-Classifier-Key` |
| `CLASSIFIER_API_KEY` | Python service | Required shared key for `/classify` |
| `ALLOW_UNAUTHENTICATED` | Python service | Local development option to skip key check |
| `AI_API_KEY` | Python service (optional) | Vision API fallback |
| `AI_BASE_URL` | Python service (optional) | Vision API endpoint |
| `AI_MODEL` | Python service (optional) | Vision API model |
| `ML_MODEL_DIR` | Python service (optional) | Folder containing model files |
| `CORS_ORIGINS` | Python service (optional) | Allowed browser origins |

No secret keys should be committed to the repository. The `.env.example` files contain placeholders for local configuration. Keep actual environment files and private API keys out of version control.

## 12. API Endpoints (Python Service)

The optional Python FastAPI service provides the following endpoints.

### Health Check

**GET** `/health`

Returns the service status and active classification engine.

Example response:

```json
{
  "status": "ok",
  "engine": "local-ml"
}
```

The actual response may include additional engine and model information.

### Waste Classification

**POST** `/classify`

Accepts an image through the multipart field `file`.

Supported formats:

- JPEG
- PNG
- WebP

Maximum upload size: 6 MB.

Authentication header:

`X-Classifier-Key`

Example response:

```json
{
  "item": "plastic",
  "category": "recyclable",
  "confidence": 87,
  "reasoning": "...",
  "steps": ["..."],
  "bin": "Blue Bin (Dry Recyclable Waste)",
  "warnings": []
}
```

### Error Responses

| Status Code | Description |
|---|---|
| 401 | Invalid authentication key |
| 413 | Image too large |
| 415 | Unsupported image format |
| 422 | Missing or invalid file |
| 503 | No classification engine available |
| 502 | Model processing error |
| 402/429 | Usage limits |

## 13. Testing

The project was tested through frontend unit tests, Python backend tests, and end-to-end application testing.

### Application Testing Results

| Test | Result |
|---|---|
| Web unit tests | 16/16 passed |
| Python tests | 16 passed, 3 skipped |
| Plastic bottle classification | Passed |
| User data isolation | Passed |
| Invalid image validation | Passed |
| Oversized image validation | Passed |

The end-to-end test verified user sign-in, image upload, waste classification, and saving the result to scan history.

### Machine Learning Model Evaluation

The MobileNetV3-Small model was evaluated using a separate held-out test dataset.

**Dataset Distribution**

| Dataset | Images |
|---|---:|
| Training | 11,387 |
| Validation | 2,442 |
| Testing | 2,438 |
| **Total** | **16,267** |

**Evaluation Results**

| Metric | Result |
|---|---:|
| Test Accuracy | 96.60% |
| Macro Precision | 95.88% |
| Macro Recall | 95.75% |
| Macro F1 Score | 95.80% |
| Weighted F1 Score | 96.60% |

**Inference Performance**

| Metric | Result |
|---|---:|
| Mean Inference Time | 10.7 ms |
| P50 | 9.0 ms |
| P95 | 12.2 ms |

These results represent the separately trained PyTorch model's evaluation performance. They do not represent the measured accuracy of the currently deployed Lovable AI Gateway classifier.

The model was evaluated on 2,438 held-out test images across 13 classes.

## 14. Deployment

### Web Application

The ECO-LENS-AI web application is published using Lovable Cloud.

- Frontend application: Deployed.
- Authentication: Available.
- Database and scan history: Available.
- AI image classification: Available through Lovable AI Gateway.

**Live Application:** https://eco-lens-waste.lovable.app

### Python Backend

The Python FastAPI backend is available in the GitHub repository but is not currently deployed.

The separately trained PyTorch model can be integrated with the live application in a future deployment.

The currently published application uses the Lovable AI Gateway for classification.

## 15. Limitations and Future Improvements

### Current Limitations

- The live application currently uses a general-purpose vision model through the Lovable AI Gateway.
- The separately trained MobileNetV3-Small model has been evaluated, but its Python FastAPI service is not yet deployed and connected to the live application.
- The model supports 13 waste classification classes and does not provide comprehensive hazardous chemical, medicine, or aerosol detection.
- Classification performance may vary depending on image quality, lighting conditions, and mixed waste items.
- Waste disposal rules and bin colours may differ between municipalities.

### Future Improvements

- Deploy and integrate the trained PyTorch model with the live application.
- Expand hazardous waste classification capabilities.
- Improve model performance using more diverse real-world waste images.
- Add multilingual waste disposal guidance.
- Integrate nearby recycling centres and waste collection locations.
- Improve real-time waste classification and mobile usability.

## For Judges – Application Access

**Application Name:** ECO-LENS-AI

**Live Application:** https://eco-lens-waste.lovable.app

Judges can access the live application using the dedicated evaluation account or create their own account.

### Evaluation Account

A dedicated evaluation account is available for judges to explore the application's existing features and previously saved data.

- The evaluation account contains sample waste classification results.
- Judges can review existing scan history and dashboard statistics.
- Login credentials will be shared separately with the judges for secure access.

### How Judges Can Evaluate ECO-LENS-AI

1. Open the [ECO-LENS-AI Live Application](https://eco-lens-waste.lovable.app).
2. Sign in using the evaluation account credentials shared with the judges.
3. Navigate to the **Waste Scanner**.
4. Upload an image of a waste item or capture an image using the camera.
5. View the AI-generated waste classification result.
6. Check the recommended waste category and disposal bin.
7. Review the disposal instructions and safety guidance.
8. Open **Scan History** to explore previously saved results.
9. Visit the **Dashboard** to view scan statistics.
10. Explore the **Learn Hub** for waste management information.

### Creating a New Account

Judges can also register using their own email address.

1. Open the live application.
2. Select the registration option.
3. Enter an email address and create a password.
4. Complete the email verification process.
5. Sign in and explore the application.

Each account can access only its own scan history.

## Screenshots

The following screenshots demonstrate the main application features.

| Dashboard | Waste Scanner |
|---|---|
| ![Dashboard](docs/screenshots/dashboard.png) | ![Scanner](docs/screenshots/scan.png) |

| Scan History | Learn Hub |
|---|---|
| ![History](docs/screenshots/history.png) | ![Learn Hub](docs/screenshots/learn.png) |

| Organic Result | Uncertain Result |
|---|---|
| ![Organic result](docs/screenshots/result-organic.png) | ![Uncertain result](docs/screenshots/result-uncertain-mixed.png) |

## AI Tools Disclosure

- Lovable AI coding assistant was used for application development.
- ChatGPT was used for code review, debugging assistance, and documentation support.
- The deployed application uses the Lovable AI Gateway vision model for AI-powered waste classification.
- AI-generated images were used for testing purposes.

## License

Released under the [MIT License](LICENSE).
