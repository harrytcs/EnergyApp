import { Amplify } from 'aws-amplify';
import {
  signIn, signOut, signUp, confirmSignUp,
  getCurrentUser, resetPassword, confirmResetPassword,
} from 'aws-amplify/auth';

export function configureAmplify() {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID ?? '',
        userPoolClientId: process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID ?? '',
      },
    },
  });
}

export const auth = {
  signIn: (email: string, password: string) =>
    signIn({ username: email, password }),

  signOut: () => signOut(),

  signUp: (email: string, password: string) =>
    signUp({ username: email, password, options: { userAttributes: { email } } }),

  confirmSignUp: (email: string, code: string) =>
    confirmSignUp({ username: email, confirmationCode: code }),

  getCurrentUser: () => getCurrentUser(),

  forgotPassword: (email: string) => resetPassword({ username: email }),

  confirmForgotPassword: (email: string, code: string, newPassword: string) =>
    confirmResetPassword({ username: email, confirmationCode: code, newPassword }),
};
