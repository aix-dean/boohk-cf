# Free AI at api.airforce
https://discord.gg/AJDsM7jtbq
## Database Switching Instructions

The Firebase Cloud Functions implementation includes a database switching feature that selects between development and production Firebase project configurations based on an environment variable retrieved from Firebase Functions config. The environment is determined by `functions.config().app?.env`, defaulting to `'dev'` if not set.

### How the Switching Works
- **Environment Variable**: The code checks `functions.config().app?.env` to choose the config.
- **Configs**:
  - `'prod'`: Uses `firebaseConfigProd` (project ID: `oh-app-bcf24`).
  - `'dev'` (default): Uses `firebaseConfigDev` (project ID: `oh-app---dev`).
- **Initialization**: `admin.initializeApp(selectedConfig)` applies the chosen config, affecting Firestore, Auth, and other Firebase services.

### Prerequisites
- Firebase CLI installed and authenticated (`firebase login`).
- Access to both Firebase projects (`oh-app-bcf24` for prod, `oh-app---dev` for dev).
- Update `functions/.firebaserc` to include project aliases if not already present:
  ```
  {
    "projects": {
      "default": "oh-app-bcf24",
      "prod": "oh-app-bcf24",
      "dev": "oh-app---dev"
    }
  }
  ```
- Navigate to the `functions` directory in your terminal.

### Step-by-Step Instructions for Deploying to Development Environment
1. **Set the environment config for dev**:
   ```
   firebase functions:config:set app.env=dev --project dev
   ```
   This sets the config variable `app.env` to `'dev'`, causing the functions to use the dev Firebase config.

2. **Deploy the functions to the dev project**:
   ```
   firebase deploy --only functions --project dev
   ```
   This deploys the functions using the dev config, connecting to the dev Firestore database and other services.

### Step-by-Step Instructions for Deploying to Production Environment
1. **Set the environment config for prod**:
   ```
   firebase functions:config:set app.env=prod --project prod
   ```
   This sets the config variable `app.env` to `'prod'`, causing the functions to use the prod Firebase config.

2. **Deploy the functions to the prod project**:
   ```
   firebase deploy --only functions --project prod
   ```
   This deploys the functions using the prod config, connecting to the prod Firestore database and other services.

### Notes
- After setting the config, redeploy to apply changes, as config updates require a new deployment.
- Verify the active project with `firebase use` before deploying.
- If the config is not set, functions default to dev environment.
- Monitor logs post-deployment to confirm the correct config is loaded (e.g., via `firebase functions:log --project <project>`).



firebase functions:config:set app.env=dev --project dev
firebase deploy --only functions --project dev


firebase deploy --only functions --project dev
firebase deploy --only functions --project prod

