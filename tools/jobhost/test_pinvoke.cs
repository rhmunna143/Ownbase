using System;
using System.Runtime.InteropServices;

namespace Test
{
    class Program
    {
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

        static void Main()
        {
            IntPtr h = CreateJobObject(IntPtr.Zero, null);
            Console.WriteLine("Job Handle: " + h);
        }
    }
}
