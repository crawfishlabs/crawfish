/**
 * @fileoverview OAuth Integrations and Third-Party Service Management
 * @description Manages OAuth connections for Google Calendar, Zoom, Plaid, and Slack
 */

import * as admin from 'firebase-admin';
import { google } from 'googleapis';
import axios from 'axios';
import crypto from 'crypto';

// Firestore: users/{userId}/integrations/{provider}
export interface IntegrationConnection {
  provider: 'google' | 'zoom' | 'plaid' | 'slack';
  status: 'connected' | 'expired' | 'revoked';
  accessToken: string;  // encrypted at rest
  refreshToken: string; // encrypted at rest
  scopes: string[];
  connectedAt: admin.firestore.Timestamp;
  expiresAt?: admin.firestore.Timestamp;
  metadata: Record<string, any>; // provider-specific (e.g., Plaid item_id)
}

export interface CalendarEvent {
  id: string;
  summary: string;
  start: { dateTime: string };
  end: { dateTime: string };
  attendees?: { email: string; responseStatus: string }[];
  conferenceData?: {
    conferenceSolution: { name: string };
    entryPoints: { entryPointType: string; uri: string }[];
  };
}

export interface Calendar {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole: string;
}

export interface ZoomMeeting {
  id: string;
  topic: string;
  start_time: string;
  duration: number;
  join_url: string;
  participants?: number;
}

export interface ZoomRecording {
  meeting_id: string;
  recording_files: {
    download_url: string;
    file_type: string;
    file_size: number;
  }[];
}

export interface PlaidAccount {
  account_id: string;
  name: string;
  type: string;
  subtype: string;
  balances: {
    available: number | null;
    current: number;
    iso_currency_code: string;
  };
}

export interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  amount: number;
  date: string;
  name: string;
  merchant_name?: string;
  category: string[];
  pending: boolean;
}

export interface TransactionSync {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: string[];
  cursor: string;
}

export interface PlaidConnection {
  item_id: string;
  access_token: string;
  institution_id: string;
  institution_name: string;
}

export interface Institution {
  institution_id: string;
  name: string;
  country_codes: string[];
  logo?: string;
}

// Google OAuth (Calendar + Meet + Drive)
// Scopes: calendar.readonly, calendar.events, drive.readonly
// Used by: Meetings (calendar sync, meeting detection), potentially Nutrition (Google Fit)
export class GoogleIntegration {
  private oauth2Client: any;

  constructor() {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
  }

  // Generate OAuth URL
  getAuthUrl(userId: string, scopes: string[]): string {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      state: userId,
      prompt: 'consent'
    });
  }

  async handleCallback(userId: string, code: string): Promise<IntegrationConnection> {
    try {
      const { tokens } = await this.oauth2Client.getAccessToken(code);
      
      const connection: IntegrationConnection = {
        provider: 'google',
        status: 'connected',
        accessToken: await this.encryptToken(tokens.access_token!),
        refreshToken: await this.encryptToken(tokens.refresh_token!),
        scopes: tokens.scope?.split(' ') || [],
        connectedAt: admin.firestore.Timestamp.now(),
        expiresAt: tokens.expiry_date ? 
          admin.firestore.Timestamp.fromMillis(tokens.expiry_date) : undefined,
        metadata: {}
      };

      await this.saveConnection(userId, connection);
      return connection;
    } catch (error) {
      console.error('Error handling Google OAuth callback:', error);
      throw error;
    }
  }

  async refreshToken(userId: string): Promise<void> {
    try {
      const connection = await this.getConnection(userId);
      if (!connection || !connection.refreshToken) {
        throw new Error('No valid refresh token found');
      }

      this.oauth2Client.setCredentials({
        refresh_token: await this.decryptToken(connection.refreshToken)
      });

      const { tokens } = await this.oauth2Client.refreshAccessToken();
      
      const updatedConnection: Partial<IntegrationConnection> = {
        accessToken: await this.encryptToken(tokens.access_token!),
        expiresAt: tokens.expiry_date ? 
          admin.firestore.Timestamp.fromMillis(tokens.expiry_date) : undefined,
        status: 'connected'
      };

      await this.updateConnection(userId, updatedConnection);
    } catch (error) {
      console.error('Error refreshing Google token:', error);
      await this.updateConnection(userId, { status: 'expired' });
      throw error;
    }
  }

  async getCalendarEvents(
    userId: string, 
    timeMin: string, 
    timeMax: string
  ): Promise<CalendarEvent[]> {
    try {
      const connection = await this.getConnection(userId);
      if (!connection || connection.status !== 'connected') {
        throw new Error('Google Calendar not connected');
      }

      this.oauth2Client.setCredentials({
        access_token: await this.decryptToken(connection.accessToken)
      });

      const calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
      
      const response = await calendar.events.list({
        calendarId: 'primary',
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
      });

      return response.data.items as CalendarEvent[];
    } catch (error) {
      console.error('Error fetching calendar events:', error);
      throw error;
    }
  }

  async getCalendarList(userId: string): Promise<Calendar[]> {
    try {
      const connection = await this.getConnection(userId);
      if (!connection || connection.status !== 'connected') {
        throw new Error('Google Calendar not connected');
      }

      this.oauth2Client.setCredentials({
        access_token: await this.decryptToken(connection.accessToken)
      });

      const calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
      
      const response = await calendar.calendarList.list();
      return response.data.items as Calendar[];
    } catch (error) {
      console.error('Error fetching calendar list:', error);
      throw error;
    }
  }

  private async getConnection(userId: string): Promise<IntegrationConnection | null> {
    const db = admin.firestore();
    const doc = await db.collection('users').doc(userId)
      .collection('integrations').doc('google').get();
    
    return doc.exists ? doc.data() as IntegrationConnection : null;
  }

  private async saveConnection(userId: string, connection: IntegrationConnection): Promise<void> {
    const db = admin.firestore();
    await db.collection('users').doc(userId)
      .collection('integrations').doc('google').set(connection);
  }

  private async updateConnection(
    userId: string, 
    updates: Partial<IntegrationConnection>
  ): Promise<void> {
    const db = admin.firestore();
    await db.collection('users').doc(userId)
      .collection('integrations').doc('google').update(updates);
  }

  private async encryptToken(token: string): Promise<string> {
    // Implementation in token-encryption.ts
    return TokenEncryption.encrypt(token);
  }

  private async decryptToken(encryptedToken: string): Promise<string> {
    // Implementation in token-encryption.ts
    return TokenEncryption.decrypt(encryptedToken);
  }
}

// Zoom OAuth
// Scopes: meeting:read, recording:read, user:read
// Used by: Meetings (meeting recordings, participant info)
export class ZoomIntegration {
  private readonly baseUrl = 'https://api.zoom.us/v2';

  getAuthUrl(userId: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.ZOOM_CLIENT_ID!,
      redirect_uri: process.env.ZOOM_REDIRECT_URI!,
      state: userId,
    });

    return `https://zoom.us/oauth/authorize?${params.toString()}`;
  }

  async handleCallback(userId: string, code: string): Promise<IntegrationConnection> {
    try {
      const tokenResponse = await axios.post('https://zoom.us/oauth/token', 
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: process.env.ZOOM_REDIRECT_URI!,
        }), {
          headers: {
            'Authorization': `Basic ${Buffer.from(
              `${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`
            ).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      const { access_token, refresh_token, expires_in, scope } = tokenResponse.data;

      const connection: IntegrationConnection = {
        provider: 'zoom',
        status: 'connected',
        accessToken: await TokenEncryption.encrypt(access_token),
        refreshToken: await TokenEncryption.encrypt(refresh_token),
        scopes: scope?.split(' ') || [],
        connectedAt: admin.firestore.Timestamp.now(),
        expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + expires_in * 1000),
        metadata: {}
      };

      await this.saveConnection(userId, connection);
      return connection;
    } catch (error) {
      console.error('Error handling Zoom OAuth callback:', error);
      throw error;
    }
  }

  async getMeetings(userId: string, from: string, to: string): Promise<ZoomMeeting[]> {
    try {
      const connection = await this.getConnection(userId);
      if (!connection || connection.status !== 'connected') {
        throw new Error('Zoom not connected');
      }

      const response = await axios.get(`${this.baseUrl}/users/me/meetings`, {
        headers: {
          'Authorization': `Bearer ${await TokenEncryption.decrypt(connection.accessToken)}`,
        },
        params: { from, to, type: 'scheduled' }
      });

      return response.data.meetings;
    } catch (error) {
      console.error('Error fetching Zoom meetings:', error);
      throw error;
    }
  }

  async getRecording(userId: string, meetingId: string): Promise<ZoomRecording> {
    try {
      const connection = await this.getConnection(userId);
      if (!connection || connection.status !== 'connected') {
        throw new Error('Zoom not connected');
      }

      const response = await axios.get(`${this.baseUrl}/meetings/${meetingId}/recordings`, {
        headers: {
          'Authorization': `Bearer ${await TokenEncryption.decrypt(connection.accessToken)}`,
        },
      });

      return response.data;
    } catch (error) {
      console.error('Error fetching Zoom recording:', error);
      throw error;
    }
  }

  private async getConnection(userId: string): Promise<IntegrationConnection | null> {
    const db = admin.firestore();
    const doc = await db.collection('users').doc(userId)
      .collection('integrations').doc('zoom').get();
    
    return doc.exists ? doc.data() as IntegrationConnection : null;
  }

  private async saveConnection(userId: string, connection: IntegrationConnection): Promise<void> {
    const db = admin.firestore();
    await db.collection('users').doc(userId)
      .collection('integrations').doc('zoom').set(connection);
  }
}

// Plaid Integration
// Used by: Budget (bank accounts, transactions)
export class PlaidIntegration {
  private readonly client: any;

  constructor() {
    // Initialize Plaid client (assuming plaid package is installed)
    // This would need: npm install plaid
  }

  // Generate Plaid Link token
  async createLinkToken(userId: string): Promise<string> {
    try {
      const request = {
        user: { client_user_id: userId },
        client_name: 'Claw Budget',
        products: ['transactions'],
        country_codes: ['US'],
        language: 'en',
        webhook: process.env.PLAID_WEBHOOK_URL,
      };

      // const response = await this.client.linkTokenCreate(request);
      // return response.data.link_token;
      
      // Placeholder - implement with actual Plaid SDK
      return 'placeholder_link_token';
    } catch (error) {
      console.error('Error creating Plaid link token:', error);
      throw error;
    }
  }

  async exchangePublicToken(userId: string, publicToken: string): Promise<PlaidConnection> {
    try {
      // const response = await this.client.linkTokenExchange({
      //   public_token: publicToken,
      // });

      // const { access_token, item_id } = response.data;

      // Get institution info
      // const institutionResponse = await this.client.institutionsGetById({
      //   institution_id: response.data.institution_id,
      //   country_codes: ['US'],
      // });

      const connection: PlaidConnection = {
        item_id: 'placeholder_item_id',
        access_token: 'placeholder_access_token',
        institution_id: 'placeholder_institution_id',
        institution_name: 'Bank of America'
      };

      // Save encrypted connection
      const integrationConnection: IntegrationConnection = {
        provider: 'plaid',
        status: 'connected',
        accessToken: await TokenEncryption.encrypt(connection.access_token),
        refreshToken: '', // Plaid doesn't use refresh tokens
        scopes: ['transactions'],
        connectedAt: admin.firestore.Timestamp.now(),
        metadata: {
          item_id: connection.item_id,
          institution_id: connection.institution_id,
          institution_name: connection.institution_name
        }
      };

      await this.saveConnection(userId, integrationConnection);
      return connection;
    } catch (error) {
      console.error('Error exchanging Plaid public token:', error);
      throw error;
    }
  }

  async getAccounts(userId: string): Promise<PlaidAccount[]> {
    try {
      const connection = await this.getConnection(userId);
      if (!connection || connection.status !== 'connected') {
        throw new Error('Plaid not connected');
      }

      // const response = await this.client.accountsGet({
      //   access_token: await TokenEncryption.decrypt(connection.accessToken),
      // });

      // return response.data.accounts;
      
      // Placeholder - implement with actual Plaid SDK
      return [];
    } catch (error) {
      console.error('Error fetching Plaid accounts:', error);
      throw error;
    }
  }

  async getTransactions(
    userId: string, 
    startDate: string, 
    endDate: string
  ): Promise<PlaidTransaction[]> {
    try {
      const connection = await this.getConnection(userId);
      if (!connection || connection.status !== 'connected') {
        throw new Error('Plaid not connected');
      }

      // Use Plaid's Transactions Get API
      // const response = await this.client.transactionsGet({
      //   access_token: await TokenEncryption.decrypt(connection.accessToken),
      //   start_date: startDate,
      //   end_date: endDate,
      // });

      // return response.data.transactions;
      
      // Placeholder - implement with actual Plaid SDK
      return [];
    } catch (error) {
      console.error('Error fetching Plaid transactions:', error);
      throw error;
    }
  }

  // Incremental sync using Plaid's Transactions Sync API
  async syncTransactions(userId: string): Promise<TransactionSync> {
    try {
      const connection = await this.getConnection(userId);
      if (!connection || connection.status !== 'connected') {
        throw new Error('Plaid not connected');
      }

      // Get last sync cursor from metadata
      const cursor = connection.metadata?.sync_cursor;

      // const response = await this.client.transactionsSync({
      //   access_token: await TokenEncryption.decrypt(connection.accessToken),
      //   cursor,
      // });

      // Update cursor in metadata
      // await this.updateConnection(userId, {
      //   metadata: { 
      //     ...connection.metadata, 
      //     sync_cursor: response.data.next_cursor 
      //   }
      // });

      // return {
      //   added: response.data.added,
      //   modified: response.data.modified,
      //   removed: response.data.removed,
      //   cursor: response.data.next_cursor
      // };

      // Placeholder - implement with actual Plaid SDK
      return {
        added: [],
        modified: [],
        removed: [],
        cursor: ''
      };
    } catch (error) {
      console.error('Error syncing Plaid transactions:', error);
      throw error;
    }
  }

  async getInstitution(institutionId: string): Promise<Institution> {
    try {
      // const response = await this.client.institutionsGetById({
      //   institution_id: institutionId,
      //   country_codes: ['US'],
      // });

      // return response.data.institution;

      // Placeholder - implement with actual Plaid SDK
      return {
        institution_id: institutionId,
        name: 'Bank of America',
        country_codes: ['US']
      };
    } catch (error) {
      console.error('Error fetching institution:', error);
      throw error;
    }
  }

  async removeConnection(userId: string, itemId: string): Promise<void> {
    try {
      const connection = await this.getConnection(userId);
      if (!connection || connection.status !== 'connected') {
        throw new Error('Plaid not connected');
      }

      // Remove from Plaid
      // await this.client.itemRemove({
      //   access_token: await TokenEncryption.decrypt(connection.accessToken),
      // });

      // Remove from our database
      const db = admin.firestore();
      await db.collection('users').doc(userId)
        .collection('integrations').doc('plaid').delete();
    } catch (error) {
      console.error('Error removing Plaid connection:', error);
      throw error;
    }
  }

  private async getConnection(userId: string): Promise<IntegrationConnection | null> {
    const db = admin.firestore();
    const doc = await db.collection('users').doc(userId)
      .collection('integrations').doc('plaid').get();
    
    return doc.exists ? doc.data() as IntegrationConnection : null;
  }

  private async saveConnection(userId: string, connection: IntegrationConnection): Promise<void> {
    const db = admin.firestore();
    await db.collection('users').doc(userId)
      .collection('integrations').doc('plaid').set(connection);
  }

  private async updateConnection(
    userId: string, 
    updates: Partial<IntegrationConnection>
  ): Promise<void> {
    const db = admin.firestore();
    await db.collection('users').doc(userId)
      .collection('integrations').doc('plaid').update(updates);
  }
}

// Slack Integration (future - for Meetings action item notifications)
export class SlackIntegration {
  getAuthUrl(userId: string): string {
    const params = new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID!,
      scope: 'chat:write,channels:read',
      redirect_uri: process.env.SLACK_REDIRECT_URI!,
      state: userId,
    });

    return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
  }

  async handleCallback(userId: string, code: string): Promise<IntegrationConnection> {
    try {
      const response = await axios.post('https://slack.com/api/oauth.v2.access', 
        new URLSearchParams({
          client_id: process.env.SLACK_CLIENT_ID!,
          client_secret: process.env.SLACK_CLIENT_SECRET!,
          code,
          redirect_uri: process.env.SLACK_REDIRECT_URI!,
        })
      );

      const { access_token, scope, team, authed_user } = response.data;

      const connection: IntegrationConnection = {
        provider: 'slack',
        status: 'connected',
        accessToken: await TokenEncryption.encrypt(access_token),
        refreshToken: '', // Slack doesn't use refresh tokens for bot tokens
        scopes: scope?.split(',') || [],
        connectedAt: admin.firestore.Timestamp.now(),
        metadata: {
          team_id: team.id,
          team_name: team.name,
          user_id: authed_user.id,
        }
      };

      await this.saveConnection(userId, connection);
      return connection;
    } catch (error) {
      console.error('Error handling Slack OAuth callback:', error);
      throw error;
    }
  }

  async sendMessage(userId: string, channel: string, message: string): Promise<void> {
    try {
      const connection = await this.getConnection(userId);
      if (!connection || connection.status !== 'connected') {
        throw new Error('Slack not connected');
      }

      await axios.post('https://slack.com/api/chat.postMessage', {
        channel,
        text: message,
      }, {
        headers: {
          'Authorization': `Bearer ${await TokenEncryption.decrypt(connection.accessToken)}`,
          'Content-Type': 'application/json',
        },
      });
    } catch (error) {
      console.error('Error sending Slack message:', error);
      throw error;
    }
  }

  private async getConnection(userId: string): Promise<IntegrationConnection | null> {
    const db = admin.firestore();
    const doc = await db.collection('users').doc(userId)
      .collection('integrations').doc('slack').get();
    
    return doc.exists ? doc.data() as IntegrationConnection : null;
  }

  private async saveConnection(userId: string, connection: IntegrationConnection): Promise<void> {
    const db = admin.firestore();
    await db.collection('users').doc(userId)
      .collection('integrations').doc('slack').set(connection);
  }
}

// Integration manager — single API for all apps
export class IntegrationManager {
  private googleIntegration = new GoogleIntegration();
  private zoomIntegration = new ZoomIntegration();
  private plaidIntegration = new PlaidIntegration();
  private slackIntegration = new SlackIntegration();

  async getConnection(
    userId: string, 
    provider: string
  ): Promise<IntegrationConnection | null> {
    try {
      const db = admin.firestore();
      const doc = await db.collection('users').doc(userId)
        .collection('integrations').doc(provider).get();
      
      return doc.exists ? doc.data() as IntegrationConnection : null;
    } catch (error) {
      console.error('Error getting connection:', error);
      return null;
    }
  }

  async listConnections(userId: string): Promise<IntegrationConnection[]> {
    try {
      const db = admin.firestore();
      const snapshot = await db.collection('users').doc(userId)
        .collection('integrations').get();
      
      return snapshot.docs.map(doc => doc.data() as IntegrationConnection);
    } catch (error) {
      console.error('Error listing connections:', error);
      return [];
    }
  }

  async disconnect(userId: string, provider: string): Promise<void> {
    try {
      const db = admin.firestore();
      
      if (provider === 'plaid') {
        // Special handling for Plaid to remove from their side too
        const connection = await this.getConnection(userId, provider);
        if (connection?.metadata?.item_id) {
          await this.plaidIntegration.removeConnection(userId, connection.metadata.item_id);
        }
      }

      await db.collection('users').doc(userId)
        .collection('integrations').doc(provider).delete();
    } catch (error) {
      console.error('Error disconnecting integration:', error);
      throw error;
    }
  }

  async isConnected(userId: string, provider: string): Promise<boolean> {
    const connection = await this.getConnection(userId, provider);
    return connection?.status === 'connected';
  }

  async refreshIfNeeded(userId: string, provider: string): Promise<void> {
    try {
      const connection = await this.getConnection(userId, provider);
      if (!connection) return;

      // Check if token is near expiry (within 5 minutes)
      if (connection.expiresAt) {
        const now = admin.firestore.Timestamp.now();
        const fiveMinutesFromNow = admin.firestore.Timestamp.fromMillis(
          now.toMillis() + 5 * 60 * 1000
        );

        if (connection.expiresAt.toMillis() < fiveMinutesFromNow.toMillis()) {
          if (provider === 'google') {
            await this.googleIntegration.refreshToken(userId);
          }
          // Add other providers as needed
        }
      }
    } catch (error) {
      console.error('Error refreshing token:', error);
      throw error;
    }
  }
}

// Token encryption placeholder - actual implementation would be in token-encryption.ts
class TokenEncryption {
  static async encrypt(token: string): Promise<string> {
    // This would be implemented in token-encryption.ts
    // For now, return a placeholder (DO NOT use in production)
    return Buffer.from(token).toString('base64');
  }

  static async decrypt(encryptedToken: string): Promise<string> {
    // This would be implemented in token-encryption.ts
    // For now, return a placeholder (DO NOT use in production)
    return Buffer.from(encryptedToken, 'base64').toString();
  }
}