using System;

namespace Calcpad.Core
{
    /// <summary>
    /// Represents an array of strings that can be used as a variable value.
    /// This enables string arrays to be defined and used in commands like $Bar and $Table.
    /// Syntax: labels = ["Ene"; "Feb"; "Mar"; "Abr"]
    /// </summary>
    internal class StringArray : IValue
    {
        private readonly string[] _values;

        internal string[] Values => _values;
        internal int Length => _values.Length;

        internal string this[int index]
        {
            get => _values[index];
            set => _values[index] = value;
        }

        internal StringArray(string[] values)
        {
            _values = values ?? throw new ArgumentNullException(nameof(values));
        }

        internal StringArray(int size)
        {
            if (size < 0)
                throw new ArgumentOutOfRangeException(nameof(size));
            _values = new string[size];
        }

        public override string ToString()
        {
            return $"[{string.Join("; ", _values)}]";
        }

        public override bool Equals(object obj)
        {
            if (obj is StringArray other)
            {
                if (_values.Length != other._values.Length)
                    return false;
                for (int i = 0; i < _values.Length; i++)
                {
                    if (_values[i] != other._values[i])
                        return false;
                }
                return true;
            }
            return false;
        }

        public override int GetHashCode()
        {
            var hash = new HashCode();
            hash.Add(_values.Length);
            foreach (var s in _values)
                hash.Add(s);
            return hash.ToHashCode();
        }
    }
}
