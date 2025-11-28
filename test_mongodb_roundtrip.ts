import { MongoClient, ObjectId } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = 'realm_sync_test';

interface ChatUser {
  _id: string;
  userId?: string;
  updatedOn?: string;
  name?: string;
  image?: string;
  emotion?: string;
  thought?: string;
  summary?: string;
  revealStatus?: string;
  firebaseToken?: string;
  isSynced: boolean;
  isTyping: boolean;
}

interface ChatRoom {
  _id: string;
  name?: string;
  text?: string;
  image?: string;
  from: string;
  to: string;
  account?: string;
  fromUnreadCount: number;
  toUnreadCount: number;
  status?: string;
  isBanned: boolean;
  isLeft: boolean;
  fromMuted: boolean;
  toMuted: boolean;
  members: string[];
  journalIds: string[];
  deletedMembers: string[];
  isFromTyping: boolean;
  isToTyping: boolean;
  time?: string;
  updatedAt?: string;
  lastMessageSyncTime?: string;
  startTime?: string;
  endTime?: string;
  journalId?: string;
  emotion?: string;
  privacy?: string;
  messageBy?: string;
  lastMessage?: string;
  lastMessageId?: string;
  isMuted: boolean;
  updateDB: boolean;
  type?: string;
  duration?: number;
  fromSynced: boolean;
  toSynced: boolean;
  syncMap: Record<string, boolean>;
  users: Record<string, ChatUser>;
  lastMessageAt: Record<string, string>;
  revealRequestBy?: string;
  revealRequestTo?: string;
  revealRequestTime?: string;
  revealStatus?: string;
  revealMessage?: string;
  sync_updated_at?: number;
  sync_update_db: boolean;
}

interface Person {
  id: string;
  firstName: string;
  lastName: string;
  age?: number;
}

interface Scooter {
  id: string;
  name: string;
  owner?: Person;
  sync_updated_at?: number;
  sync_update_db: boolean;
}

async function testMongoDRoundTrip() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');
    
    const db = client.db(DB_NAME);
    const chatroomsCollection = db.collection<ChatRoom>('chatrooms');
    const scootersCollection = db.collection<Scooter>('scooters');
    
    // Test 1: ChatRoom with nested users (Map<String, ChatUser>)
    console.log('=== Test 1: ChatRoom with Nested Users ===');
    
    const testRoomId = `test-room-${Date.now()}`;
    const testUserId1 = `user1-${Date.now()}`;
    const testUserId2 = `user2-${Date.now()}`;
    
    const originalChatRoom: ChatRoom = {
      _id: testRoomId,
      name: 'MongoDB Test Room',
      from: 'user1',
      to: 'user2',
      updatedAt: '2025-11-28T14:30:04.025Z',
      fromUnreadCount: 5,
      toUnreadCount: 3,
      isBanned: false,
      isLeft: false,
      fromMuted: false,
      toMuted: false,
      members: ['user1', 'user2'],
      journalIds: ['journal1'],
      deletedMembers: [],
      isFromTyping: false,
      isToTyping: false,
      isMuted: false,
      updateDB: false,
      fromSynced: true,
      toSynced: true,
      syncMap: { 'user1': true, 'user2': false },
      users: {
        [testUserId1]: {
          _id: testUserId1,
          userId: 'firebase-alice',
          updatedOn: '2025-11-28T14:30:04.025Z',
          name: 'Alice',
          image: 'https://example.com/alice.jpg',
          emotion: 'happy',
          thought: 'Great conversation!',
          summary: 'Friendly chat',
          revealStatus: 'revealed',
          firebaseToken: 'token-alice',
          isSynced: true,
          isTyping: false
        },
        [testUserId2]: {
          _id: testUserId2,
          userId: 'firebase-bob',
          updatedOn: '2025-11-28T15:45:30.500Z',
          name: 'Bob',
          image: 'https://example.com/bob.jpg',
          emotion: 'excited',
          isSynced: false,
          isTyping: true
        }
      },
      lastMessageAt: {
        'user1': '2025-11-28T14:30:00.000Z',
        'user2': '2025-11-28T14:35:00.000Z'
      },
      sync_update_db: false
    };
    
    console.log('📤 Sending to MongoDB...');
    await chatroomsCollection.insertOne(originalChatRoom);
    console.log('✅ Inserted ChatRoom');
    
    console.log('\n📥 Retrieving from MongoDB...');
    const retrievedRoom = await chatroomsCollection.findOne({ _id: testRoomId });
    
    if (!retrievedRoom) {
      throw new Error('ChatRoom not found!');
    }
    
    console.log('✅ Retrieved ChatRoom\n');
    console.log('Verification:');
    console.log(`  Room name: ${retrievedRoom.name} ${retrievedRoom.name === originalChatRoom.name ? '✅' : '❌'}`);
    console.log(`  UpdatedAt: ${retrievedRoom.updatedAt} ${retrievedRoom.updatedAt === originalChatRoom.updatedAt ? '✅' : '❌'}`);
    console.log(`  From unread: ${retrievedRoom.fromUnreadCount} ${retrievedRoom.fromUnreadCount === originalChatRoom.fromUnreadCount ? '✅' : '❌'}`);
    console.log(`  Members count: ${retrievedRoom.members.length} ${retrievedRoom.members.length === originalChatRoom.members.length ? '✅' : '❌'}`);
    console.log(`  Users count: ${Object.keys(retrievedRoom.users).length} ${Object.keys(retrievedRoom.users).length === 2 ? '✅' : '❌'}`);
    
    const user1 = retrievedRoom.users[testUserId1];
    const user2 = retrievedRoom.users[testUserId2];
    
    console.log('\nNested User 1 (Alice):');
    console.log(`  Name: ${user1?.name} ${user1?.name === 'Alice' ? '✅' : '❌'}`);
    console.log(`  UpdatedOn: ${user1?.updatedOn} ${user1?.updatedOn === '2025-11-28T14:30:04.025Z' ? '✅' : '❌'}`);
    console.log(`  Emotion: ${user1?.emotion} ${user1?.emotion === 'happy' ? '✅' : '❌'}`);
    console.log(`  Thought: ${user1?.thought} ${user1?.thought === 'Great conversation!' ? '✅' : '❌'}`);
    
    console.log('\nNested User 2 (Bob):');
    console.log(`  Name: ${user2?.name} ${user2?.name === 'Bob' ? '✅' : '❌'}`);
    console.log(`  UpdatedOn: ${user2?.updatedOn} ${user2?.updatedOn === '2025-11-28T15:45:30.500Z' ? '✅' : '❌'}`);
    console.log(`  IsTyping: ${user2?.isTyping} ${user2?.isTyping === true ? '✅' : '❌'}`);
    
    // Test 2: Scooter with nested Person (to-one relationship)
    console.log('\n\n=== Test 2: Scooter with Nested Person ===');
    
    const testScooterId = new ObjectId().toHexString();
    const testPersonId = new ObjectId().toHexString();
    
    const originalScooter: Scooter = {
      id: testScooterId,
      name: 'Electric Thunder',
      owner: {
        id: testPersonId,
        firstName: 'John',
        lastName: 'Doe',
        age: 30
      },
      sync_update_db: false
    };
    
    console.log('📤 Sending to MongoDB...');
    await scootersCollection.insertOne(originalScooter as any);
    console.log('✅ Inserted Scooter');
    
    console.log('\n�� Retrieving from MongoDB...');
    const retrievedScooter = await scootersCollection.findOne({ id: testScooterId });
    
    if (!retrievedScooter) {
      throw new Error('Scooter not found!');
    }
    
    console.log('✅ Retrieved Scooter\n');
    console.log('Verification:');
    console.log(`  Scooter name: ${retrievedScooter.name} ${retrievedScooter.name === originalScooter.name ? '✅' : '❌'}`);
    console.log(`  Owner exists: ${!!retrievedScooter.owner} ${!!retrievedScooter.owner ? '✅' : '❌'}`);
    console.log(`  Owner firstName: ${retrievedScooter.owner?.firstName} ${retrievedScooter.owner?.firstName === 'John' ? '✅' : '❌'}`);
    console.log(`  Owner lastName: ${retrievedScooter.owner?.lastName} ${retrievedScooter.owner?.lastName === 'Doe' ? '✅' : '❌'}`);
    console.log(`  Owner age: ${retrievedScooter.owner?.age} ${retrievedScooter.owner?.age === 30 ? '✅' : '❌'}`);
    
    // Test 3: DateTime format verification
    console.log('\n\n=== Test 3: DateTime Format Verification ===');
    
    const dateFields = [
      { field: 'updatedAt', value: retrievedRoom.updatedAt },
      { field: 'users[user1].updatedOn', value: user1?.updatedOn },
      { field: 'users[user2].updatedOn', value: user2?.updatedOn },
      { field: 'lastMessageAt[user1]', value: retrievedRoom.lastMessageAt['user1'] },
    ];
    
    console.log('Checking DateTime formats:');
    dateFields.forEach(({ field, value }) => {
      if (value) {
        const isISOFormat = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value);
        const parseable = !isNaN(Date.parse(value));
        console.log(`  ${field}: ${value}`);
        console.log(`    ISO-8601 format: ${isISOFormat ? '✅' : '❌'}`);
        console.log(`    Parseable: ${parseable ? '✅' : '❌'}`);
      }
    });
    
    // Test 4: Type preservation
    console.log('\n\n=== Test 4: Type Preservation ===');
    
    console.log('Checking data types:');
    console.log(`  fromUnreadCount (number): ${typeof retrievedRoom.fromUnreadCount === 'number' ? '✅' : '❌'} (${typeof retrievedRoom.fromUnreadCount})`);
    console.log(`  isBanned (boolean): ${typeof retrievedRoom.isBanned === 'boolean' ? '✅' : '❌'} (${typeof retrievedRoom.isBanned})`);
    console.log(`  members (array): ${Array.isArray(retrievedRoom.members) ? '✅' : '❌'}`);
    console.log(`  users (object): ${typeof retrievedRoom.users === 'object' ? '✅' : '❌'} (${typeof retrievedRoom.users})`);
    console.log(`  user1.isSynced (boolean): ${typeof user1?.isSynced === 'boolean' ? '✅' : '❌'} (${typeof user1?.isSynced})`);
    
    // Cleanup
    console.log('\n🧹 Cleaning up test data...');
    await chatroomsCollection.deleteOne({ _id: testRoomId });
    await scootersCollection.deleteOne({ id: testScooterId });
    console.log('✅ Cleanup complete');
    
    console.log('\n🎉 All MongoDB round-trip tests passed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

testMongoDRoundTrip();
