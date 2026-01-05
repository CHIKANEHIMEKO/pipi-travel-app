## 🍤 PIPI Travel App

This is my own travelling app 
use google sheets as database

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Configure Environment Variables
EXPO_PUBLIC_API_URL=your_google_apps_script_url
EXPO_PUBLIC_MAPS_LIST_URL=your_google_maps_list_url

3. Start the app (use by ios)

   ```bash
   npx expo start --tunnel
   ```

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Project Structure
├── app/               # Expo Router logic (Main application screens)
├── assets/            # Images, splash screen, and app icons
├── components/        # UI components (ItineraryRow, RouteConnector, etc.)
├── .env               # Environment variables (Protected by .gitignore)
├── .gitignore         # Git ignore rules for security
└── README.md          # Project documentation


## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
