import pkg from "@whiskeysockets/baileys/WAProto/index.js";
import { Curve, signedKeyPair } from "@whiskeysockets/baileys/lib/Utils/crypto.js";
import { generateRegistrationId } from "@whiskeysockets/baileys/lib/Utils/generics.js";
import { randomBytes } from "crypto";

const { proto } = pkg;

const initAuthCreds = () => {
  const identityKey = Curve.generateKeyPair();
  return {
    noiseKey: Curve.generateKeyPair(),
    signedIdentityKey: identityKey,
    signedPreKey: signedKeyPair(identityKey, 1),
    registrationId: generateRegistrationId(),
    advSecretKey: randomBytes(32).toString("base64"),
    processedHistoryMessages: [],
    nextPreKeyId: 1,
    firstUnuploadedPreKeyId: 1,
    accountSettings: {
      unarchiveChats: false,
    },
  };
};

const BufferJSON = {
  replacer: (_, value) =>
    Buffer.isBuffer(value) || value instanceof Uint8Array
      ? { type: "Buffer", data: value.toString("base64") }
      : value,
  reviver: (_, value) =>
    value?.type === "Buffer" ? Buffer.from(value.data, "base64") : value,
};

export default async function useMongoDBAuthState(collection) {
  // Write data to MongoDB with error handling
  const writeData = async (data, id) => {
    try {
      if (
        !data ||
        (Array.isArray(data) && data.length === 0) ||
        (typeof data === "object" && Object.keys(data).length === 0)
      ) {
        return; // Skip processing empty data
      }

      if (Array.isArray(data)) {
        console.warn(`Value for ${id} is an array, converting to object.`);
        data = Object.fromEntries(data.map((item, index) => [`index_${index}`, item]));
      }

      const serializedData = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
      await collection.updateOne(
        { _id: id },
        { $set: serializedData },
        { upsert: true }
      );
    } catch (error) {
      console.error(`Error writing data for ${id}:`, error);
    }
  };

  // Read data from MongoDB with error handling
  const readData = async (id) => {
    try {
      const data = await collection.findOne({ _id: id });
      return data ? JSON.parse(JSON.stringify(data), BufferJSON.reviver) : null;
    } catch (error) {
      console.error(`Error reading data for ${id}:`, error);
      return null;
    }
  };

  // Remove data from MongoDB with error handling
  const removeData = async (id) => {
    try {
      await collection.deleteOne({ _id: id });
      // console.log(`Successfully removed data for ${id}`);
    } catch (error) {
      console.error(`Error removing data for ${id}:`, error);
    }
  };

  // Automatic session cleanup
  const resetKey = async (type, id) => {
    try {
      await removeData(`${type}-${id}`);
      // console.log(`Removed invalid key for ${type}-${id}`);

      const newKey = Curve.generateKeyPair();
      await writeData(newKey, `${type}-${id}`);
      // console.log(`Generated and saved new key for ${type}-${id}`);
    } catch (error) {
      console.error(`Error resetting key for ${type}-${id}:`, error);
    }
  };

  // Initialize credentials if they don't exist
  const creds = (await readData("creds")) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        // Get keys from MongoDB
        get: async (type, ids) => {
          const keyPromises = ids.map(async (id) => {
            try {
              const data = await readData(`${type}-${id}`);
              if (type === "app-state-sync-key" && data) {
                return [id, proto.Message.AppStateSyncKeyData.fromObject(data)];
              }
              return [id, data];
            } catch (error) {
              await handleSessionError(id, error);
              return [id, null];
            }
          });
          const keyResults = await Promise.all(keyPromises);
          return Object.fromEntries(keyResults);
        },

        // Set keys to MongoDB
        set: async (data) => {
          const keyPromises = Object.entries(data).flatMap(([type, items]) =>
            Object.entries(items).map(async ([id, value]) => {
              try {
                if (value) {
                  if (Array.isArray(value)) {
                    // console.warn(
                    //   `Warning: Value for ${type}-${id} is an array. Attempting to reset and regenerate key.`
                    // );
                    await resetKey(type, id);
                    // Generate new key
                    const newKey = Curve.generateKeyPair();
                    await writeData(newKey, `${type}-${id}`);
                    // console.log(`Key for ${type}-${id} has been reset and new key generated.`);
                  } else {
                    await writeData(value, `${type}-${id}`);
                  }
                } else {
                  await removeData(`${type}-${id}`);
                }
              } catch (error) {
                console.error(`Error processing ${type}-${id}:`, error);
              }
            })
          );
          await Promise.all(keyPromises);
        },
      },
    },
    saveCreds: async () => {
      await writeData(creds, "creds");
    },
  };
}